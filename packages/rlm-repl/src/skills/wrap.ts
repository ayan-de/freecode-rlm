import type { Skill } from "./types.js";

export interface WrappedSkill {
  /** Code to inject into the sandbox. Defines `globalThis.<name>`. */
  bindCode: string;
  /** Human description used by the system prompt. */
  description: string;
  /** Skill name. */
  name: string;
}

/**
 * Wrap a host-side Skill into a sandbox-bindable bundle.
 *
 * The bindCode looks like:
 *
 *   globalThis.websearch = {
 *     run: (...args) => globalThis.__skill_websearch_ref.apply(
 *       undefined, args,
 *       { arguments: { copy: true }, result: { copy: true, promise: true } }
 *     ),
 *     description: "Search Google via the Serper API.",
 *     name: "websearch",
 *   };
 *   // Callable shorthand: websearch(q) === websearch.run(q)
 *   globalThis.websearch.__call = globalThis.websearch.run;
 *
 * The host must set `__skill_<name>_ref` as an ivm.Reference bound to
 * the skill's `run` function before running bindCode.
 */
export function wrapSkillModule(skill: Skill): WrappedSkill {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(skill.name)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(skill.name)} (must be a JS identifier)`);
  }
  const refName = `__skill_${skill.name}_ref`;
  const bindCode = `
    globalThis[${JSON.stringify(skill.name)}] = {
      run: (...args) => globalThis[${JSON.stringify(refName)}].apply(
        undefined, args,
        { arguments: { copy: true }, result: { copy: true, promise: true } }
      ),
      description: ${JSON.stringify(skill.description)},
      name: ${JSON.stringify(skill.name)},
    };
  `;
  return { bindCode, description: skill.description, name: skill.name };
}
