import type { ChatMessage, LMClient } from "@freecode-rs/client";

export interface CoreREPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
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
  metadata: {
    startedAt: number;
    finishedAt: number;
    totalSubCalls: number;
    depthReached: number;
    finishedReason: "final" | "max_iterations" | "error";
  };
}

export class RLMAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RLMAbortError";
  }
}
