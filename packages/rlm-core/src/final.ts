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

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
