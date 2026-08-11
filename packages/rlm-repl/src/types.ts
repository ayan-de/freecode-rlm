export interface REPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
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
