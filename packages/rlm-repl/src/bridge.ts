import ivm from "isolated-vm";
import type { IsolatedVmREPL } from "./isolated-vm.js";

/**
 * Host callbacks that the sandbox calls via `llm_query` / `rlm_query`.
 * `llm_query` is a flat LLM call; `rlm_query` spawns a nested RLM.
 *
 * `bash`/`readFile`/`writeFile` are optional: the three "system" tools the
 * model can reach for instead of writing everything in pure JS (mirrors
 * prime-agent's bash/edit/ipython trio). Omit them to keep the REPL
 * sandboxed to pure computation.
 */
export interface BridgeCallbacks {
  llmQuery: (prompt: string) => Promise<string>;
  rlmQuery: (prompt: string) => Promise<string>;
  bash?: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
}

const CORE_BRIDGE_SETUP = `
  globalThis.llm_query = (p) =>
    globalThis.__llm_query_ref.apply(
      undefined,
      [p],
      {
        arguments: { copy: true },
        result: { copy: true, promise: true },
      },
    );
  globalThis.rlm_query = (p) =>
    globalThis.__rlm_query_ref.apply(
      undefined,
      [p],
      {
        arguments: { copy: true },
        result: { copy: true, promise: true },
      },
    );
`;

const TOOLS_BRIDGE_SETUP = `
  globalThis.bash = (cmd) =>
    globalThis.__bash_ref.apply(
      undefined,
      [cmd],
      {
        arguments: { copy: true },
        result: { copy: true, promise: true },
      },
    );
  globalThis.readFile = (path) =>
    globalThis.__read_file_ref.apply(
      undefined,
      [path],
      {
        arguments: { copy: true },
        result: { copy: true, promise: true },
      },
    );
  globalThis.writeFile = (path, content) =>
    globalThis.__write_file_ref.apply(
      undefined,
      [path, content],
      {
        arguments: { copy: true },
        result: { copy: true, promise: true },
      },
    );
`;

/**
 * Wrap a callback so its rejection is observed on the host side
 * (silencing Node's unhandledRejection warning) while still
 * propagating to the sandbox caller.
 */
function bridgeCallback<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return async (...args: Args) => {
    // The try/catch wrapper is intentional: it observes the rejection on
    // the host side before re-throwing so that ivm.Reference forwards it
    // to the sandbox without triggering Node's unhandledRejection.
    // eslint-disable-next-line no-useless-catch
    try {
      return await fn(...args);
    } catch (e) {
      throw e;
    }
  };
}

/**
 * Expose `llm_query`/`rlm_query` (always) and `bash`/`readFile`/`writeFile`
 * (only when provided) as functions in the sandbox. Each call forwards
 * synchronously to a host callback via ivm.Reference and waits for the
 * resulting Promise. Throws from the host become rejections inside the
 * sandbox's IIFE.
 */
export function installBridge(repl: IsolatedVmREPL, cbs: BridgeCallbacks): void {
  const { isolate, context } = repl as unknown as {
    isolate: ivm.Isolate;
    context: ivm.Context;
  };

  context.global.set("__llm_query_ref", new ivm.Reference(bridgeCallback(cbs.llmQuery)));
  context.global.set("__rlm_query_ref", new ivm.Reference(bridgeCallback(cbs.rlmQuery)));
  isolate.compileScriptSync(CORE_BRIDGE_SETUP).runSync(context, { timeout: 1000 });

  if (cbs.bash || cbs.readFile || cbs.writeFile) {
    const noSystemTool = (name: string) => async () => {
      throw new Error(`${name} is not enabled for this RLM run`);
    };
    context.global.set(
      "__bash_ref",
      new ivm.Reference(bridgeCallback(cbs.bash ?? noSystemTool("bash"))),
    );
    context.global.set(
      "__read_file_ref",
      new ivm.Reference(bridgeCallback(cbs.readFile ?? noSystemTool("readFile"))),
    );
    context.global.set(
      "__write_file_ref",
      new ivm.Reference(bridgeCallback(cbs.writeFile ?? noSystemTool("writeFile"))),
    );
    isolate.compileScriptSync(TOOLS_BRIDGE_SETUP).runSync(context, { timeout: 1000 });
  }
}
