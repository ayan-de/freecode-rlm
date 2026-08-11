import type { ChatMessage } from "@freecode-rs/client";
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

export class RLM {
  private readonly client: RLMOptions["client"];
  private readonly repl: CoreREPL;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private readonly verbose: boolean;

  constructor(opts: RLMOptions) {
    this.client = opts.client;
    this.repl = opts.repl;
    this.systemPrompt = opts.systemPrompt ?? BUILTIN_SYSTEM_PROMPT;
    this.maxIterations = opts.maxIterations ?? 50;
    this.verbose = opts.verbose ?? false;
  }

  async completion(prompt: string): Promise<RLMResult> {
    const startedAt = Date.now();
    await this.repl.load("context", prompt);

    const iterations: Iteration[] = [];
    let finalAnswer: string | null = null;

    for (let i = 0; i < this.maxIterations; i++) {
      const messages = buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        iterations,
      });
      const assistantMessage = await this.client.chat(messages);
      const code = extractReplCode(assistantMessage.content);

      if (!code) {
        // Model didn't emit any code. Record and stop (treat last text as answer).
        iterations.push({
          index: i,
          assistantMessage,
          replResult: { success: true, stdout: [], durationMs: 0 },
          subCallsAtStart: 0,
        });
        finalAnswer = assistantMessage.content;
        break;
      }

      const replResult = await this.repl.execute(code);
      iterations.push({
        index: i,
        assistantMessage,
        replResult,
        subCallsAtStart: 0,
      });

      if (this.verbose) {
        console.error(
          `[rlm iter ${i}] code=${code.length}B stdout=${replResult.stdout.length}L success=${replResult.success}`,
        );
      }

      const final = await extractFinal(replResult, () => this.repl.inspect());
      if (final) {
        finalAnswer = final.answer;
        break;
      }
    }

    const finishedAt = Date.now();
    const lastAssistant = iterations[iterations.length - 1]?.assistantMessage.content ?? "";
    const finishedReason: RLMResult["metadata"]["finishedReason"] =
      finalAnswer !== null ? "final" : "max_iterations";

    return {
      response: finalAnswer ?? lastAssistant,
      iterations,
      metadata: {
        startedAt,
        finishedAt,
        totalSubCalls: 0,
        depthReached: 0,
        finishedReason,
      },
    };
  }
}

// Re-export so external imports only need @freecode-rs/core
export type { ChatMessage } from "@freecode-rs/client";
