import type { ChatMessage } from "@freecode-rs/client";
import {
  installBridge,
  installBuiltins,
  IsolatedVmREPL,
} from "@freecode-rs/repl";
import type {
  CoreREPL,
  Iteration,
  RLMOptions,
  RLMResult,
} from "./types.js";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";
import { extractReplCode } from "./utils/code-extract.js";
import { buildHistoryMessages } from "./utils/messages.js";
import { extractFinal } from "./final.js";
import { Budget, BudgetExceededError } from "./budget.js";

export class RLM {
  private readonly client: RLMOptions["client"];
  private readonly repl: CoreREPL;
  private readonly systemPrompt: string;
  private readonly maxDepth: number;
  private readonly maxIterations: number;
  private readonly verbose: boolean;
  private readonly currentDepth: number;
  private readonly budget: Budget;
  private userPrompt = "";
  private maxDepthSeen = 0;

  constructor(
    opts: RLMOptions,
    internal?: { currentDepth?: number; budget?: Budget },
  ) {
    this.client = opts.client;
    this.repl = opts.repl;
    this.systemPrompt = opts.systemPrompt ?? BUILTIN_SYSTEM_PROMPT;
    this.maxDepth = opts.maxDepth ?? 3;
    this.maxIterations = opts.maxIterations ?? 50;
    this.verbose = opts.verbose ?? false;
    this.currentDepth = internal?.currentDepth ?? 0;
    this.budget =
      internal?.budget ??
      new Budget({
        maxIterations: this.maxIterations,
        maxSubCalls: opts.maxSubCalls ?? 100,
      });
  }

  async completion(prompt: string, opts?: { context?: string }): Promise<RLMResult> {
    const startedAt = Date.now();
    this.userPrompt = prompt;
    // Default: the prompt itself is loaded as `context`. Callers can override
    // via opts.context when they want a short user-facing prompt with a
    // different (typically larger) REPL-scoped context — e.g. NIAH tests.
    await this.repl.load("context", opts?.context ?? prompt);

    // FINAL/PRINT/FINAL_VAR and the host bridge are injected into the sandbox
    // on the first call. For non-IsolatedVmREPL (e.g. test fakes) we skip —
    // they typically pre-install their own helpers via eval-time injection.
    if (this.repl instanceof IsolatedVmREPL) {
      installBuiltins(this.repl);
      installBridge(this.repl, {
        llmQuery: (p) => this.callLlm(p),
        rlmQuery: (p) => this.callRlm(p),
      });
    }

    const iterations: Iteration[] = [];
    let finalAnswer: string | null = null;
    let finishedReason: RLMResult["metadata"]["finishedReason"] = "max_iterations";

    for (let i = 0; i < this.maxIterations; i++) {
      try {
        this.budget.tryConsumeIteration();
      } catch (e) {
        if (e instanceof BudgetExceededError) break;
        throw e;
      }
      const messages = buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        userPrompt: this.userPrompt,
        iterations,
      });
      let assistantMessage: ChatMessage;
      try {
        assistantMessage = await this.client.chat(messages);
      } catch (e) {
        const err = e as Error;
        iterations.push({
          index: i,
          assistantMessage: {
            role: "assistant",
            content: `[client error] ${err.message}`,
          },
          replResult: {
            success: false,
            stdout: [],
            error: { name: "LMError", message: err.message, trace: "" },
            durationMs: 0,
          },
          subCallsAtStart: this.budget.subCalls,
        });
        finishedReason = "error";
        break;
      }

      const code = extractReplCode(assistantMessage.content);
      if (!code) {
        // Model didn't emit any code. Record and stop (treat last text as answer).
        iterations.push({
          index: i,
          assistantMessage,
          replResult: { success: true, stdout: [], durationMs: 0 },
          subCallsAtStart: this.budget.subCalls,
        });
        finalAnswer = assistantMessage.content;
        finishedReason = "final";
        break;
      }

      const replResult = await this.repl.execute(code);
      iterations.push({
        index: i,
        assistantMessage,
        replResult,
        subCallsAtStart: this.budget.subCalls,
      });

      if (this.verbose) {
        console.error(
          `[rlm d=${this.currentDepth} i=${i}] code=${code.length}B success=${replResult.success}`,
        );
      }

      const final = await extractFinal(replResult, () => this.repl.inspect());
      if (final) {
        finalAnswer = final.answer;
        finishedReason = "final";
        break;
      }
    }

    return {
      response:
        finalAnswer ??
        // Strip <think>...</think> blocks when the model falls through to a
        // plain-text "final answer" — keeps CLI output clean.
        stripThink(
          iterations[iterations.length - 1]?.assistantMessage.content ?? "",
        ),
      iterations,
      metadata: {
        startedAt,
        finishedAt: Date.now(),
        totalSubCalls: this.budget.subCalls,
        depthReached: this.maxDepthSeen,
        finishedReason,
      },
    };
  }

  private async callLlm(prompt: string): Promise<string> {
    // Budget check first; throws BudgetExceededError which propagates as a
    // rejection inside the sandbox IIFE.
    this.budget.tryConsumeSubCall();
    const reply = await this.client.chat([{ role: "user", content: prompt }]);
    return reply.content;
  }

  private async callRlm(prompt: string): Promise<string> {
    // Depth check first: at maxDepth, rlm_query silently degrades to llm_query.
    if (this.currentDepth + 1 >= this.maxDepth) {
      if (this.verbose) {
        console.error(
          `[rlm d=${this.currentDepth}] rlm_query depth-limited, degrading to llm_query`,
        );
      }
      return this.callLlm(prompt);
    }
    this.budget.tryConsumeSubCall();
    if (this.currentDepth + 1 > this.maxDepthSeen) {
      this.maxDepthSeen = this.currentDepth + 1;
    }

    const childRepl = new IsolatedVmREPL();
    const child = new RLM(
      {
        client: this.client,
        repl: childRepl,
        systemPrompt: this.systemPrompt,
        maxDepth: this.maxDepth,
        maxIterations: this.maxIterations,
        verbose: this.verbose,
      },
      { currentDepth: this.currentDepth + 1, budget: this.budget },
    );
    try {
      const result = await child.completion(prompt);
      return result.response;
    } finally {
      await childRepl.dispose();
    }
  }
}

// Some models prefix their plain-text responses with a <think>...</think>
// block before giving the final answer. Strip it so callers (notably the
// CLI) get a clean answer.
function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Re-export so external imports only need @freecode-rs/core
export type { ChatMessage } from "@freecode-rs/client";