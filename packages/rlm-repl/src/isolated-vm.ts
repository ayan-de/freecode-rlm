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

/**
 * Attach a recovery hint to the two errors the sandbox's execution model
 * makes easy to hit but hard to read. Both are artefacts of running the
 * model's code as persistent global script code rather than as an eval'd
 * function body.
 */
function withHint(name: string, message: string): string {
  if (name === "SyntaxError" && message.includes("await is only valid")) {
    return (
      message +
      " — wrap your code in an async IIFE: (async () => { ...your code... })()"
    );
  }
  if (name === "SyntaxError" && message.includes("already been declared")) {
    return (
      message +
      " — REPL variables persist between turns, so this name is held over from" +
      " an earlier turn. Assign to it (`name = ...`) or choose a new name."
    );
  }
  return message;
}

export class IsolatedVmREPL implements REPL {
  private isolate: ivm.Isolate;
  private context: ivm.Context;
  private timeoutMs: number;
  private memoryMb: number;
  private stdout: string[] = [];
  private bindings = new Map<string, unknown>();

  constructor(opts: REPLOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.memoryMb = opts.memoryMb ?? 256;
    this.isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    this.context = this.isolate.createContextSync();
    const setupScript = this.isolate.compileScriptSync(SANDBOX_CONSOLE_SETUP);
    setupScript.runSync(this.context, { timeout: 1000 });
  }

  async load(name: string, value: unknown): Promise<void> {
    this.bindings.set(name, value);
    // JSON path — functions/undefineds are dropped. Push onto globalThis so
    // user code can reference the name directly (e.g. load('x', 42); execute('x*2')).
    const json = JSON.stringify(value, (_k, v) => (typeof v === "function" ? undefined : v));
    const decl = `globalThis[${JSON.stringify(name)}] = ${json};`;
    const script = this.isolate.compileScriptSync(decl);
    script.runSync(this.context, { timeout: 1000 });
  }

  async execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult> {
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const start = Date.now();

    // User code runs as top-level GLOBAL code, not inside a function wrapper.
    // That is what makes `const`/`let`/function declarations outlive the call:
    // global code records them in the context's global lexical environment,
    // which lives as long as the isolate. Running the same source through
    // `eval()` inside a wrapper scopes those declarations to the wrapper and
    // discards them on return, so every iteration started from a blank slate
    // (paper §2 requires a persistent environment — see VERIFICATION.md V-03).
    //
    // The cost of dropping the wrapper is that stdout capture and the FINAL
    // side-channel no longer have a closure to live in, so they are bracketed
    // by two small scripts around the user's code instead.
    this.runControlScript(
      // Mark where this call's output starts, and clear the side-channel so a
      // FINAL from a PRIOR execute() can't leak forward as a false positive.
      "globalThis.__mark = __stdout.length; globalThis.__finalCall = undefined;",
    );

    let value: unknown;
    let failure: { name: string; message: string; trace: string } | undefined;
    try {
      // compileScriptSync throws for syntax errors (e.g. bare top-level
      // await); run() throws for runtime errors, rejections and timeouts.
      const script = this.isolate.compileScriptSync(code);
      value = await script.run(this.context, {
        timeout,
        promise: true,
        copy: true,
      });
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; stack?: string };
      const name = err.name ?? "Error";
      failure = {
        name,
        message: withHint(name, err.message ?? String(e)),
        trace: err.stack ?? "",
      };
    }

    const tail = this.collectTail();
    for (const line of tail.captured) this.stdout.push(line);

    if (failure) {
      return {
        success: false,
        stdout: tail.captured,
        error: failure,
        finalCall: tail.finalCall,
        durationMs: Date.now() - start,
      };
    }
    return {
      success: true,
      stdout: tail.captured,
      expression: value,
      finalCall: tail.finalCall,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Run a trusted bookkeeping script in the sandbox. Failures here are not
   * the model's problem, so they are swallowed — a torn-down isolate (OOM,
   * terminated by timeout) is the expected cause.
   */
  private runControlScript(src: string): void {
    try {
      this.isolate.compileScriptSync(src).runSync(this.context, { timeout: 1000 });
    } catch {
      // isolate is unusable; execute() reports the underlying error instead.
    }
  }

  /**
   * Collect the stdout produced since the mark, plus whatever FINAL/FINAL_VAR
   * recorded on the side-channel. Runs after user code whether it succeeded,
   * threw, or timed out, so partial output is never lost.
   */
  private collectTail(): { captured: string[]; finalCall?: unknown } {
    try {
      const script = this.isolate.compileScriptSync(
        "(function() { return {" +
          " captured: __stdout.slice(globalThis.__mark || 0)," +
          " finalCall: globalThis.__finalCall" +
          " }; })()",
      );
      return script.runSync(this.context, { timeout: 1000, copy: true }) as {
        captured: string[];
        finalCall?: unknown;
      };
    } catch {
      return { captured: [] };
    }
  }

  readStdout(): string[] {
    return [...this.stdout];
  }

  async inspect(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.bindings) out[k] = v;
    return out;
  }

  async dispose(): Promise<void> {
    this.context.release();
    this.isolate.dispose();
  }
}
