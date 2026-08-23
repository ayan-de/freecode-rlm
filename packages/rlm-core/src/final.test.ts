import { describe, it, expect, vi } from "vitest";
import { extractFinal, extractFinalFromText } from "./final.js";

/** Build a lookup() over a fixed set of REPL variables. */
const scope =
  (vars: Record<string, unknown>) =>
  async (name: string): Promise<unknown> =>
    vars[name];

describe("extractFinal", () => {
  it("returns the string for FINAL('hello')", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __final: "hello" }, durationMs: 1 },
      scope({}),
    );
    expect(out).toEqual({ kind: "final", answer: "hello" });
  });

  it("resolves FINAL_VAR('result') via lookup()", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "result" }, durationMs: 1 },
      scope({ result: "the answer" }),
    );
    expect(out).toEqual({ kind: "final", answer: "the answer" });
  });

  it("looks up exactly the name FINAL_VAR named", async () => {
    const lookup = vi.fn(scope({ report: "done" }));
    await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "report" }, durationMs: 1 },
      lookup,
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("report");
  });

  it("returns null when expression is not a sentinel", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: 42, durationMs: 1 },
      scope({}),
    );
    expect(out).toBeNull();
  });

  it("returns null when expression is undefined (no FINAL called)", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: undefined, durationMs: 1 },
      scope({}),
    );
    expect(out).toBeNull();
  });

  it("stringifies non-string FINAL_VAR scope values via JSON", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "obj" }, durationMs: 1 },
      scope({ obj: { a: 1, b: [2, 3] } }),
    );
    expect(out).toEqual({ kind: "final", answer: '{"a":1,"b":[2,3]}' });
  });

  it("returns 'undefined' string when FINAL_VAR points at a missing variable", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "missing" }, durationMs: 1 },
      scope({ result: "present" }),
    );
    expect(out).toEqual({ kind: "final", answer: "undefined" });
  });

  it("does not call lookup() when expression is not a sentinel", async () => {
    const lookup = vi.fn(scope({}));
    await extractFinal(
      { success: true, stdout: [], expression: 42, durationMs: 1 },
      lookup,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("prefers finalCall over expression (bare FINAL() statement not returned)", async () => {
    const out = await extractFinal(
      {
        success: true,
        stdout: [],
        expression: undefined, // async arrow body never returned FINAL's value
        finalCall: { __final: "hello" },
        durationMs: 1,
      },
      scope({}),
    );
    expect(out).toEqual({ kind: "final", answer: "hello" });
  });
});

describe("extractFinalFromText", () => {
  it("parses FINAL(...) written as plain text with no code block", async () => {
    const out = await extractFinalFromText("Here's my answer.\nFINAL(42)", scope({}));
    expect(out).toEqual({ kind: "final", answer: "42" });
  });

  it("resolves FINAL_VAR(name) via lookup()", async () => {
    const out = await extractFinalFromText(
      "FINAL_VAR('result')",
      scope({ result: "the answer" }),
    );
    expect(out).toEqual({ kind: "final", answer: "the answer" });
  });

  it("returns null when neither pattern is present", async () => {
    const out = await extractFinalFromText("just some prose", scope({}));
    expect(out).toBeNull();
  });
});
