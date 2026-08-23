import type { CoreREPLResult } from "./types.js";

export type ExtractedFinal =
  | { kind: "final"; answer: string }
  | null;

export async function extractFinal(
  result: CoreREPLResult,
  lookup: (name: string) => Promise<unknown>,
): Promise<ExtractedFinal> {
  // Prefer the side-channel (set whenever FINAL/FINAL_VAR was called at
  // all) over the code's completion value — a model writing "FINAL(x);"
  // as a bare statement inside a braced async arrow body never makes that
  // the completion value, so relying on `expression` alone misses it.
  const sentinel = result.finalCall ?? result.expression;
  if (!sentinel || typeof sentinel !== "object") {
    return null;
  }
  const e = sentinel as { __final?: unknown; __finalVar?: unknown };
  if (typeof e.__final === "string") {
    return { kind: "final", answer: e.__final };
  }
  if (typeof e.__finalVar === "string") {
    return { kind: "final", answer: stringify(await lookup(e.__finalVar)) };
  }
  return null;
}

// Fallback for models that write FINAL(...)/FINAL_VAR(...) as plain text
// instead of calling them as REPL functions (matches reference find_final_answer).
export async function extractFinalFromText(
  text: string,
  lookup: (name: string) => Promise<unknown>,
): Promise<ExtractedFinal> {
  const varMatch = /^\s*FINAL_VAR\((.*?)\)/ms.exec(text);
  if (varMatch?.[1] !== undefined) {
    const name = varMatch[1].trim().replace(/^['"]|['"]$/g, "");
    return { kind: "final", answer: stringify(await lookup(name)) };
  }
  const finalMatch = /^\s*FINAL\((.*?)\)/ms.exec(text);
  if (finalMatch?.[1] !== undefined) {
    return { kind: "final", answer: finalMatch[1].trim() };
  }
  return null;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
