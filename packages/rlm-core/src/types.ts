import type { ChatMessage, LMClient } from "@freecode-rs/client";
import type { CompactionEvent, CompactionOptions } from "./compaction.js";

export interface CoreREPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
  // Set when FINAL()/FINAL_VAR() was called during execution, independent
  // of whether the code's completion value was that call's return value.
  finalCall?: unknown;
  error?: { name: string; message: string; trace: string };
  durationMs: number;
}

export interface CoreREPL {
  load(name: string, value: unknown): Promise<void>;
  execute(code: string, opts?: { timeoutMs?: number }): Promise<CoreREPLResult>;
  readStdout(): string[];
  inspect(): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export interface RLMOptions {
  client: LMClient;
  repl: CoreREPL;
  systemPrompt?: string;
  maxDepth?: number;
  maxIterations?: number;
  maxSubCalls?: number;
  verbose?: boolean;
  // Exposes bash()/readFile()/writeFile() in the REPL, giving the model
  // shell and filesystem access on the host machine. Off by default since
  // it lets model-written code run arbitrary commands.
  enableSystemTools?: boolean;
  // Context-window compaction. When the projected message list exceeds
  // (contextWindow - reserveTokens), older iterations are summarized
  // and replaced with a single summary iteration. See compaction.ts for
  // the trigger math and the structured summarization prompt format.
  // Pass `compaction: { enabled: false }` to opt out entirely.
  compaction?: CompactionOptions & { enabled?: boolean };
}

export interface Iteration {
  index: number;
  assistantMessage: ChatMessage;
  replResult: CoreREPLResult;
  subCallsAtStart: number;
}

export interface RLMResult {
  response: string;
  iterations: Iteration[];
  // Full non-system conversation so far (prior history + this turn's user
  // prompt + this turn's iteration exchanges). Pass back as
  // `completion(prompt, { history: result.messages })` to continue the
  // conversation across multiple completion() calls.
  messages: ChatMessage[];
  metadata: {
    startedAt: number;
    finishedAt: number;
    totalSubCalls: number;
    depthReached: number;
    finishedReason: "final" | "max_iterations" | "error";
    // One entry per compaction that fired during this completion() call.
    // Empty if compaction was disabled or never triggered. See
    // CompactionEvent in compaction.ts for field semantics.
    compactionEvents: CompactionEvent[];
  };
}

export class RLMAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RLMAbortError";
  }
}
