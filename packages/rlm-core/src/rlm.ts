import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import type { ChatMessage } from "@freecode-rs/client";
import {
  installBridge,
  installBuiltins,
  installSkills,
  IsolatedVmREPL,
  type Skill,
} from "@freecode-rs/repl";
import type {
  CoreREPL,
  Iteration,
  RLMOptions,
  RLMResult,
} from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { extractReplCode } from "./utils/code-extract.js";
import { buildHistoryMessages } from "./utils/messages.js";
import { extractFinal, extractFinalFromText } from "./final.js";
import { Budget, BudgetExceededError } from "./budget.js";
import {
  compactIterations,
  DEFAULT_COMPACTION_OPTIONS,
  shouldCompact,
  type CompactionEvent,
} from "./compaction.js";

const execAsync = promisify(exec);

export class RLM {
  private readonly client: RLMOptions["client"];
  private readonly repl: CoreREPL;
  private readonly systemPrompt: string;
  private readonly maxDepth: number;
  private readonly maxIterations: number;
  private readonly verbose: boolean;
  private readonly currentDepth: number;
  private readonly budget: Budget;
  private readonly enableSystemTools: boolean;
  private readonly skills: ReadonlyArray<Skill>;
  // Compaction is opt-in: caller passes `opts.compaction` to enable it.
  // When undefined, no compaction runs and the trajectory can grow
  // unbounded (which is fine for short completions).
  private readonly compactionOpts:
    | (NonNullable<RLMOptions["compaction"]> & { enabled: boolean })
    | undefined;
  private userPrompt = "";
  private maxDepthSeen = 0;
  // Tracks every callLlm/callRlm/callBash invocation spawned during the
  // current completion() call so we can await them all before returning —
  // otherwise a per-iteration REPL timeout can abort while e.g. a
  // Promise.all of rlm_query() calls is still running on the host, and the
  // caller may dispose this.repl while that orphaned work is still trying
  // to touch it, crashing with "Isolate is disposed" outside any catch.
  private pendingSubCalls: Promise<unknown>[] = [];

  constructor(
    opts: RLMOptions,
    internal?: { currentDepth?: number; budget?: Budget },
  ) {
    this.client = opts.client;
    this.repl = opts.repl;
    this.maxDepth = opts.maxDepth ?? 3;
    this.maxIterations = opts.maxIterations ?? 50;
    this.verbose = opts.verbose ?? false;
    this.enableSystemTools = opts.enableSystemTools ?? false;
    this.skills = opts.skills ?? [];
    // Compaction defaults to enabled when opts.compaction is passed at
    // all — the caller opts out with `{ enabled: false }`. We don't
    // apply defaults from DEFAULT_COMPACTION_OPTIONS here; that
    // happens inside shouldCompact / compactIterations so the trigger
    // math stays consistent with the rest of the module.
    this.compactionOpts = opts.compaction
      ? { enabled: opts.compaction.enabled ?? true, ...opts.compaction }
      : undefined;
    this.systemPrompt =
      opts.systemPrompt ??
      buildSystemPrompt({
        enableSystemTools: this.enableSystemTools,
        skills: this.skills,
      });
    this.currentDepth = internal?.currentDepth ?? 0;
    this.budget =
      internal?.budget ??
      new Budget({
        maxIterations: this.maxIterations,
        maxSubCalls: opts.maxSubCalls ?? 100,
      });
  }

  async completion(
    prompt: string,
    opts?: { context?: string; history?: ChatMessage[] },
  ): Promise<RLMResult> {
    const startedAt = Date.now();
    const history = opts?.history ?? [];
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
        ...(this.enableSystemTools
          ? {
              bash: (cmd: string) => this.callBash(cmd),
              readFile: (path: string) => fs.readFile(path, "utf8"),
              writeFile: (path: string, content: string) => fs.writeFile(path, content, "utf8"),
            }
          : {}),
      });
      installSkills(this.repl, [...this.skills]);
    }

    const iterations: Iteration[] = [];
    let finalAnswer: string | null = null;
    let finishedReason: RLMResult["metadata"]["finishedReason"] = "max_iterations";
    const compactionEvents: CompactionEvent[] = [];
    let compactionCount = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      try {
        this.budget.tryConsumeIteration();
      } catch (e) {
        if (e instanceof BudgetExceededError) break;
        throw e;
      }

      // Compaction check: runs between iterations, AFTER the previous
      // iteration was pushed, so the just-finished exchange is included
      // in the token count. Triggers a summarization call (counted as a
      // sub-call against the shared budget) and replaces `iterations`
      // with [summary, ...recent]. The next iteration then sees the
      // compacted history through buildHistoryMessages.
      if (this.compactionOpts?.enabled) {
        const maxCompactions =
          this.compactionOpts.maxCompactions ?? DEFAULT_COMPACTION_OPTIONS.maxCompactions;
        if (compactionCount < maxCompactions) {
          await this.maybeCompact({
            iterations,
            compactionEvents,
            compactionCount,
            onCounted: () => {
              compactionCount++;
            },
          });
        }
      }

      const messages = buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        history,
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
        // No code block. Still honor a plain-text FINAL(...)/FINAL_VAR(...)
        // (matches reference find_final_answer), else fall back to raw text.
        iterations.push({
          index: i,
          assistantMessage,
          replResult: { success: true, stdout: [], durationMs: 0 },
          subCallsAtStart: this.budget.subCalls,
        });
        const textFinal = await extractFinalFromText(assistantMessage.content, (n) =>
          this.repl.lookup(n),
        );
        finalAnswer = textFinal ? textFinal.answer : assistantMessage.content;
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

      const final = await extractFinal(replResult, (n) => this.repl.lookup(n));
      if (final) {
        finalAnswer = final.answer;
        finishedReason = "final";
        break;
      }
    }

    // Wait out any sub-calls still running in the background (e.g. from a
    // Promise.all whose enclosing execute() call already timed out) before
    // returning, so callers never dispose this.repl while descendants are
    // still using it.
    await Promise.allSettled(this.pendingSubCalls);
    this.pendingSubCalls = [];

    return {
      response:
        finalAnswer ??
        // Strip <think>...</think> blocks when the model falls through to a
        // plain-text "final answer" — keeps CLI output clean.
        stripThink(
          iterations[iterations.length - 1]?.assistantMessage.content ?? "",
        ),
      iterations,
      // Everything after the system prompt: prior history + this turn's
      // user prompt + this turn's iteration exchanges. Feed straight back
      // in as the next call's opts.history to keep the conversation going.
      messages: buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        history,
        userPrompt: this.userPrompt,
        iterations,
      }).slice(1),
      metadata: {
        startedAt,
        finishedAt: Date.now(),
        totalSubCalls: this.budget.subCalls,
        depthReached: this.maxDepthSeen,
        finishedReason,
        compactionEvents,
      },
    };
  }

  /**
   * Run the compaction trigger + summary call, mutating `iterations` in
   * place and appending to `compactionEvents`. Splits out the trigger
   * math (shouldCompact), the LM call (client.chat on the summary
   * prompt), and the in-place array swap so each piece stays testable.
   *
   * The summary call counts as a sub-call against the shared Budget so
   * a runaway trajectory doesn't burn through maxSubCalls on summaries.
   */
  private async maybeCompact(args: {
    iterations: Iteration[];
    compactionEvents: CompactionEvent[];
    compactionCount: number;
    onCounted: () => void;
  }): Promise<void> {
    const { iterations, compactionEvents, compactionCount, onCounted } = args;
    if (!this.compactionOpts?.enabled) return;
    const extraTokens = Math.ceil(
      (this.systemPrompt.length + this.userPrompt.length) / 4,
    );
    if (!shouldCompact(iterations, this.compactionOpts, extraTokens)) return;

    // Budget reservation: a summarization call is a sub-call from the
    // root's perspective, so it counts against maxSubCalls. If we don't
    // have headroom, skip the compaction rather than crashing the loop.
    try {
      this.budget.tryConsumeSubCall();
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        if (this.verbose) {
          console.error(
            `[rlm d=${this.currentDepth}] compaction skipped: sub-call budget exhausted`,
          );
        }
        return;
      }
      throw e;
    }

    const summarizer: (prompt: string) => Promise<string> = async (prompt) => {
      const reply = await this.client.chat([{ role: "user", content: prompt }]);
      // Some providers wrap content in an array; normalize.
      const content = reply.content;
      return typeof content === "string" ? content : JSON.stringify(content);
    };

    let result;
    try {
      result = await compactIterations(
        iterations,
        this.compactionOpts,
        summarizer,
        { compactionCount: compactionCount + 1 },
      );
    } catch (e) {
      // A failed summarization (network, refusal, whatever) must not
      // take down the loop. Log and continue with the uncompacted
      // history. Note: we DO NOT increment compactionCount here, so a
      // failing summarizer can't burn through the maxCompactions
      // budget and prevent future attempts.
      if (this.verbose) {
        console.error(`[rlm d=${this.currentDepth}] compaction failed:`, e);
      }
      return;
    }

    // Nothing to compact (everything fits in the keepRecent window).
    // Don't count this against maxCompactions, don't emit an event,
    // don't replace iterations — bail out silently. This is the
    // common case when contextWindow was tuned high relative to the
    // trajectory length.
    if (result.iterationsReplaced === 0) {
      if (this.verbose) {
        console.error(
          `[rlm d=${this.currentDepth}] compaction no-op (keepRecent satisfied)`,
        );
      }
      return;
    }

    // Nothing to compact (everything fits in the keepRecent window).
    // Don't count this against maxCompactions, don't emit an event,
    // don't replace iterations — bail out silently. This is the
    // common case when contextWindow was tuned high relative to the
    // trajectory length.
    if (result.iterationsReplaced === 0) {
      if (this.verbose) {
        console.error(
          `[rlm d=${this.currentDepth}] compaction no-op (keepRecent satisfied)`,
        );
      }
      return;
    }

    // Mutate iterations in place: clear and refill so existing
    // references held by callers (none today, but future-proof) stay
    // valid. Re-index so subsequent iterations line up with their
    // array positions.
    iterations.length = 0;
    for (let k = 0; k < result.newIterations.length; k++) {
      iterations.push({ ...result.newIterations[k]!, index: k });
    }
    onCounted();

    compactionEvents.push({
      atIteration: iterations.length - 1,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      iterationsReplaced: result.iterationsReplaced,
      compactionCount,
    });

    if (this.verbose) {
      console.error(
        `[rlm d=${this.currentDepth}] compacted: ${result.tokensBefore}→${result.tokensAfter} tokens, replaced ${result.iterationsReplaced} iterations (count=${compactionCount})`,
      );
    }
  }

  private callBash(
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const p = this.callBashImpl(command);
    this.pendingSubCalls.push(p);
    return p;
  }

  private async callBashImpl(
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(e),
        exitCode: err.code ?? 1,
      };
    }
  }

  // callLlm/callRlm are called from the sandbox via the bridge. They're
  // tracked in pendingSubCalls (see completion()'s final await) so a
  // per-iteration REPL timeout can't orphan them.
  private callLlm(prompt: string): Promise<string> {
    const p = this.callLlmImpl(prompt);
    this.pendingSubCalls.push(p);
    return p;
  }

  private async callLlmImpl(prompt: string): Promise<string> {
    // Budget check first; throws BudgetExceededError which propagates as a
    // rejection inside the sandbox IIFE.
    this.budget.tryConsumeSubCall();
    const reply = await this.client.chat([{ role: "user", content: prompt }]);
    return reply.content;
  }

  private callRlm(prompt: string): Promise<string> {
    const p = this.callRlmImpl(prompt);
    this.pendingSubCalls.push(p);
    return p;
  }

  private async callRlmImpl(prompt: string): Promise<string> {
    // Depth check first: at maxDepth, rlm_query silently degrades to llm_query.
    if (this.currentDepth + 1 >= this.maxDepth) {
      if (this.verbose) {
        console.error(
          `[rlm d=${this.currentDepth}] rlm_query depth-limited, degrading to llm_query`,
        );
      }
      return this.callLlmImpl(prompt);
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
        enableSystemTools: this.enableSystemTools,
        // Inherit the parent's compaction policy so a long sub-RLM
        // doesn't grow unbounded while the parent is waiting on it.
        ...(this.compactionOpts ? { compaction: this.compactionOpts } : {}),
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