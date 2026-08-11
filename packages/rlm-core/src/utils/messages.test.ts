import { describe, it, expect } from "vitest";
import { buildHistoryMessages } from "./messages.js";
import type { Iteration } from "../types.js";

const okIter: Iteration = {
  index: 0,
  assistantMessage: { role: "assistant", content: "hi" },
  replResult: { success: true, stdout: ["a", "b"], expression: 1, durationMs: 1 },
  subCallsAtStart: 0,
};

const errIter: Iteration = {
  index: 1,
  assistantMessage: { role: "assistant", content: "oh no" },
  replResult: {
    success: false,
    stdout: [],
    durationMs: 2,
    error: { name: "ReferenceError", message: "x is not defined", trace: "at line 1" },
  },
  subCallsAtStart: 0,
};

describe("buildHistoryMessages", () => {
  it("starts with system prompt, then user prompt, then one user message per iteration", () => {
    const out = buildHistoryMessages({
      systemPrompt: "SYS",
      userPrompt: "find the answer",
      iterations: [okIter],
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: "find the answer" });
    expect(out[2]?.role).toBe("user");
    expect(out[2]?.content).toContain("hi");
    expect(out[2]?.content).toContain("Result:");
  });

  it("formats successful results with stdout and expression", () => {
    const out = buildHistoryMessages({
      systemPrompt: "S",
      userPrompt: "U",
      iterations: [okIter],
    });
    const resultMsg = out[2];
    expect(resultMsg?.content).toContain("stdout:");
    expect(resultMsg?.content).toContain("a\nb");
    expect(resultMsg?.content).toContain("expression: 1");
  });

  it("formats failed results with error message and trace", () => {
    const out = buildHistoryMessages({
      systemPrompt: "S",
      userPrompt: "U",
      iterations: [errIter],
    });
    const resultMsg = out[2];
    expect(resultMsg?.content).toContain("error: x is not defined");
    expect(resultMsg?.content).toContain("trace: at line 1");
  });

  it("returns system + user prompt when there are no iterations", () => {
    const out = buildHistoryMessages({
      systemPrompt: "S",
      userPrompt: "U",
      iterations: [],
    });
    expect(out).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
  });

  it("emits one combined user message per iteration when there are multiple", () => {
    const out = buildHistoryMessages({
      systemPrompt: "S",
      userPrompt: "U",
      iterations: [okIter, errIter],
    });
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ role: "user", content: "U" });
    expect(out[2]?.content).toContain("hi");
    expect(out[3]?.content).toContain("error: x is not defined");
  });
});
