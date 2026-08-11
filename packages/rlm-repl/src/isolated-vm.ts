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
    // Wrap user code so we capture the final expression AND the sandbox-side __stdout
    // after execution. We use a function wrapper that returns both, then transfer the
    // captured stdout back to the host via copy: true.
    const wrapper =
      "(async function() {" +
      "  const __capturedStdout = [];" +
      "  const __origPush = __stdout.push.bind(__stdout);" +
      "  __stdout.push = (...args) => { __capturedStdout.push(args.map(a =>" +
      "    typeof a === 'string' ? a : JSON.stringify(a)" +
      "  ).join(' ')); return __origPush(...args); };" +
      "  try {" +
      "    const __result = eval(__USER_CODE__);" +
      "    return { success: true, value: await __result, captured: __capturedStdout };" +
      "  } catch (e) {" +
      "    return { success: false, error: { name: e.name, message: e.message, trace: e.stack || '' }, captured: __capturedStdout };" +
      "  }" +
      "})()";
    const scriptSrc = wrapper.replace("__USER_CODE__", JSON.stringify(code));
    try {
      const script = this.isolate.compileScriptSync(scriptSrc);
      const ref = (await script.run(this.context, {
        timeout,
        promise: true,
        copy: true,
      })) as
        | { success: true; value: unknown; captured: string[] }
        | { success: false; error: { name: string; message: string; trace: string }; captured: string[] };
      for (const line of ref.captured) this.stdout.push(line);
      if (ref.success) {
        return {
          success: true,
          stdout: [...ref.captured],
          expression: ref.value,
          durationMs: Date.now() - start,
        };
      }
      return {
        success: false,
        stdout: [...ref.captured],
        error: ref.error,
        durationMs: Date.now() - start,
      };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; stack?: string };
      // isolated-vm timeout throws "Script execution timed out."
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
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.bindings) out[k] = v;
    return out;
  }

  async dispose(): Promise<void> {
    this.context.release();
    this.isolate.dispose();
  }
}
