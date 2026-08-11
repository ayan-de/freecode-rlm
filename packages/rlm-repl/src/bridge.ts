import ivm from "isolated-vm";
import type { IsolatedVmREPL } from "./isolated-vm.js";

/**
 * Host callbacks that the sandbox calls via `llm_query` / `rlm_query`.
 * `llm_query` is a flat LLM call; `rlm_query` spawns a nested RLM.
 */
export interface BridgeCallbacks {
  llmQuery: (prompt: string) => Promise<string>;
  rlmQuery: (prompt: string) => Promise<string>;
}

const BRIDGE_SETUP = `
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

/**
 * Wrap a callback so its rejection is observed on the host side
 * (silencing Node's unhandledRejection warning) while still
 * propagating to the sandbox caller.
 */
function bridgeCallback<T>(fn: (p: string) => Promise<T>): (p: string) => Promise<T> {
  return async (prompt: string) => {
    try {
      return await fn(prompt);
    } catch (e) {
      // observed by host (no unhandledRejection), and re-thrown so
      // ivm.Reference forwards the rejection to the sandbox caller.
      throw e;
    }
  };
}

/**
 * Expose `llm_query` and `rlm_query` as async functions in the sandbox.
 * Each call forwards synchronously to a host callback via ivm.Reference
 * and waits for the resulting Promise. Throws from the host become
 * rejections inside the sandbox's IIFE.
 */
export function installBridge(repl: IsolatedVmREPL, cbs: BridgeCallbacks): void {
  const { isolate, context } = repl as unknown as {
    isolate: ivm.Isolate;
    context: ivm.Context;
  };

  const llmRef = new ivm.Reference(bridgeCallback(cbs.llmQuery));
  const rlmRef = new ivm.Reference(bridgeCallback(cbs.rlmQuery));

  context.global.set("__llm_query_ref", llmRef);
  context.global.set("__rlm_query_ref", rlmRef);

  const setup = isolate.compileScriptSync(BRIDGE_SETUP);
  setup.runSync(context, { timeout: 1000 });
}
