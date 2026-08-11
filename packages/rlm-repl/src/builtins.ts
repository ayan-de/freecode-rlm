import ivm from "isolated-vm";
import type { IsolatedVmREPL } from "./isolated-vm.js";

/**
 * Sandbox-side wrappers for FINAL/FINAL_VAR/PRINT. PRINT is mapped to
 * the existing `console.log` capture path so visible stdout is unified
 * across both channels. FINAL/FINAL_VAR return sentinel objects that
 * the host's `extractFinal` recognizes from the REPL result's expression.
 *
 * No host callbacks are required for these helpers — they are pure
 * value-returning within the sandbox.
 */
const BUILTINS_SETUP = `
  globalThis.PRINT = (...args) => {
    console.log(...args);
  };
  globalThis.FINAL = (answer) => ({ __final: String(answer) });
  globalThis.FINAL_VAR = (name) => ({ __finalVar: String(name) });
`;

/**
 * Install FINAL/PRINT/FINAL_VAR into the sandbox. Called by RLM.completion()
 * so user code written by the model can use these helpers. PRINT echoes
 * into the sandbox console so its output lands in the same stdout buffer
 * as console.log().
 */
export function installBuiltins(repl: IsolatedVmREPL): void {
  const { isolate, context } = repl as unknown as {
    isolate: ivm.Isolate;
    context: ivm.Context;
  };

  const setup = isolate.compileScriptSync(BUILTINS_SETUP);
  setup.runSync(context, { timeout: 1000 });
}
