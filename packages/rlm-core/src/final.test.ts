import { describe, it, expect, vi } from "vitest";
import { extractFinal, extractFinalFromText } from "./final.js";

describe("extractFinal", () => {
  it("returns the string for FINAL('hello')", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __final: "hello" }, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toEqual({ kind: "final", answer: "hello" });
  });

  it("resolves FINAL_VAR('result') via inspect()", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "result" }, durationMs: 1 },
      async () => ({ result: "the answer" }),
    );
    expect(out).toEqual({ kind: "final", answer: "the answer" });
  });

  it("returns null when expression is not a sentinel", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: 42, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toBeNull();
  });

  it("returns null when expression is undefined (no FINAL called)", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: undefined, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toBeNull();
  });

  it("stringifies non-string FINAL_VAR scope values via JSON", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "obj" }, durationMs: 1 },
      async () => ({ obj: { a: 1, b: [2, 3] } }),
    );
    expect(out).toEqual({ kind: "final", answer: '{"a":1,"b":[2,3]}' });
  });

  it("returns 'undefined' string when FINAL_VAR points at a missing variable", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "missing" }, durationMs: 1 },
      async () => ({ result: "present" }),
    );
    expect(out).toEqual({ kind: "final", answer: "undefined" });
  });

  it("does not call inspect() when expression is not a sentinel", async () => {
    const inspect = vi.fn(async () => ({}));
    await extractFinal(
      { success: true, stdout: [], expression: 42, durationMs: 1 },
      inspect,
    );
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("extractFinalFromText", () => {
  it("parses FINAL(...) written as plain text with no code block", async () => {
    const out = await extractFinalFromText("Here's my answer.\nFINAL(42)", async () => ({}));
    expect(out).toEqual({ kind: "final", answer: "42" });
  });

  it("resolves FINAL_VAR(name) via inspect()", async () => {
    const out = await extractFinalFromText("FINAL_VAR('result')", async () => ({
      result: "the answer",
    }));
    expect(out).toEqual({ kind: "final", answer: "the answer" });
  });

  it("returns null when neither pattern is present", async () => {
    const out = await extractFinalFromText("just some prose", async () => ({}));
    expect(out).toBeNull();
  });
});
