import ivm from "isolated-vm";
import type { IsolatedVmREPL } from "../isolated-vm.js";
import { wrapSkillModule } from "./wrap.js";
import type { Skill } from "./types.js";

/**
 * Wrap a skill's `run` so its rejection is observed on the host side
 * (silencing Node's unhandledRejection warning) while still propagating
 * to the sandbox caller. Mirrors `bridgeCallback` in bridge.ts.
 */
function observedRun(skill: Skill): Skill["run"] {
  return async (...args: unknown[]) => {
    try {
      return await skill.run(...args);
    } catch (e) {
      throw e;
    }
  };
}

/**
 * Install a set of skills into the sandbox as pre-imported globals.
 *
 * Each skill becomes a sandbox global named after `skill.name`, with a
 * `.run(...args)` method and a `.description` field. The LLM calls them
 * from inside the REPL like:
 *
 *   (async () => {
 *     const out = await websearch.run("prime agent");
 *     PRINT(out);
 *   })()
 *
 * Idempotent: re-running with the same skill list overwrites the
 * previous bindings (the `__skill_<name>_ref` globals are replaced).
 */
export function installSkills(repl: IsolatedVmREPL, skills: Skill[]): void {
  const { isolate, context } = repl as unknown as {
    isolate: ivm.Isolate;
    context: ivm.Context;
  };

  // Set each host Reference first so the bindCode can find it.
  for (const skill of skills) {
    const refName = `__skill_${skill.name}_ref`;
    context.global.set(refName, new ivm.Reference(observedRun(skill)));
  }

  // Run each bindCode so the global is defined.
  const meta: { name: string; description: string }[] = [];
  for (const skill of skills) {
    const wrapped = wrapSkillModule(skill);
    const script = isolate.compileScriptSync(wrapped.bindCode);
    script.runSync(context, { timeout: 1000 });
    meta.push({ name: skill.name, description: skill.description });
  }

  // Expose a meta list so the LLM can introspect installed skills.
  const metaDecl = `globalThis.__skillMeta = ${JSON.stringify(meta)};`;
  isolate.compileScriptSync(metaDecl).runSync(context, { timeout: 1000 });
}