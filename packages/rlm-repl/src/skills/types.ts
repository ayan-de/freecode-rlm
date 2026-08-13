/**
 * A skill is a host-side async function exposed to the LLM as a
 * pre-imported global in the REPL sandbox. Mirrors prime-agent's
 * Python skill contract: one exported `run(*args, **kwargs) -> str`
 * (async allowed), with a description injected into the system prompt.
 */
export interface Skill {
  /** Sandbox global name (e.g. "websearch"). Must be a valid JS identifier. */
  name: string;
  /** One-line description shown in the system prompt. */
  description: string;
  /** Host-side implementation. Receives positional args from the sandbox. */
  run: (...args: unknown[]) => string | Promise<string>;
}

/** Lightweight metadata for the system prompt (no code references). */
export interface SkillMeta {
  name: string;
  description: string;
}
