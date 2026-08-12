import type { CoreREPLResult } from "./types.js";

export type ExtractedFinal =
  | { kind: "final"; answer: string }
  | null;

export async function extractFinal(
  result: CoreREPLResult,
  inspect: () => Promise<Record<string, unknown>>,
): Promise<ExtractedFinal> {
  const expr = result.expression;
  if (!expr || typeof expr !== "object") {
    return null;
  }
  const e = expr as { __final?: unknown; __finalVar?: unknown };
  if (typeof e.__final === "string") {
    return { kind: "final", answer: e.__final };
  }
  if (typeof e.__finalVar === "string") {
    const scope = await inspect();
    const v = scope[e.__finalVar];
    return { kind: "final", answer: stringify(v) };
  }
  return null;
}

// Fallback for models that write FINAL(...)/FINAL_VAR(...) as plain text
// instead of calling them as REPL functions (matches reference find_final_answer).
export async function extractFinalFromText(
  text: string,
  inspect: () => Promise<Record<string, unknown>>,
): Promise<ExtractedFinal> {
  const varMatch = /^\s*FINAL_VAR\((.*?)\)/ms.exec(text);
  if (varMatch?.[1] !== undefined) {
    const name = varMatch[1].trim().replace(/^['"]|['"]$/g, "");
    const scope = await inspect();
    return { kind: "final", answer: stringify(scope[name]) };
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
