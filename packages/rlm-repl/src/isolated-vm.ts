import ivm from "isolated-vm";
import type { REPL, REPLOptions, REPLResult } from "./types.js";

const SANDBOX_CONSOLE_SETUP = `
const __stdout = [];
const console = {
  log: (...args) => { __stdout.push(args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  error: (...args) => { __stdout.push('[error] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  warn: (...args) => { __stdout.push('[warn] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
};
`;

export class IsolatedVmREPL implements REPL {
  private isolate: ivm.Isolate;
  private context: ivm.Context;
  private timeoutMs: number;
  private memoryMb: number;
  private stdout: string[] = [];

  constructor(opts: REPLOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.memoryMb = opts.memoryMb ?? 256;
    this.isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    this.context = this.isolate.createContextSync();
    const setupScript = this.isolate.compileScriptSync(SANDBOX_CONSOLE_SETUP);
    setupScript.runSync(this.context, { timeout: 1000 });
  }

  async load(_name: string, _value: unknown): Promise<void> {
    throw new Error("not implemented");
  }

  async execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult> {
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const start = Date.now();
    try {
      const wrapped =
        "(() => { let __last; try { __last = eval(__USER_CODE__); } " +
        "catch (e) { throw e; } return { __last, __stdout }; })()";
      const scriptSrc = wrapped.replace("__USER_CODE__", JSON.stringify(code));
      const script = this.isolate.compileScriptSync(scriptSrc);
      const resultRef = (await script.run(this.context, {
        timeout,
        promise: true,
        copy: true,
      })) as { __last: unknown; __stdout: string[] };
      const combined = resultRef.__stdout;
      for (const line of combined) this.stdout.push(line);
      return {
        success: true,
        stdout: [...combined],
        expression: resultRef.__last,
        durationMs: Date.now() - start,
      };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; stack?: string };
      return {
        success: false,
        stdout: [...this.stdout],
        error: {
          name: err.name ?? "Error",
          message: err.message ?? String(e),
          trace: err.stack ?? "",
        },
        durationMs: Date.now() - start,
      };
    }
  }

  readStdout(): string[] {
    return [...this.stdout];
  }

  async inspect(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  async dispose(): Promise<void> {
    this.context.release();
    this.isolate.dispose();
  }
}
