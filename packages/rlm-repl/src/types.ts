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
  /**
   * Read one variable out of REPL scope by name, or `undefined` if no such
   * variable exists. This is what backs `FINAL_VAR(name)`.
   *
   * Lookup is by name rather than by enumeration because top-level
   * `const`/`let` in the model's code become global *lexical* bindings,
   * which are not properties of `globalThis` and cannot be listed.
   */
  lookup(name: string): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface REPLOptions {
  timeoutMs?: number;
  memoryMb?: number;
}
