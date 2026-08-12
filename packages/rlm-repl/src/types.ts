export interface REPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
  // Set when FINAL()/FINAL_VAR() was called anywhere during execution,
  // regardless of whether its return value ended up as the code's
  // completion value. See builtins.ts for why this side-channel exists.
  finalCall?: unknown;
  error?: { name: string; message: string; trace: string };
  durationMs: number;
}

export interface REPL {
  load(name: string, value: unknown): Promise<void>;
  execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult>;
  readStdout(): string[];
  inspect(): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export interface REPLOptions {
  timeoutMs?: number;
  memoryMb?: number;
}
