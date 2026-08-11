import { describe, it, expect } from "vitest";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";

describe("BUILTIN_SYSTEM_PROMPT", () => {
  it("mentions llm_query, rlm_query, PRINT, FINAL, FINAL_VAR", () => {
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/llm_query/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/rlm_query/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/PRINT/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/FINAL\(/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/FINAL_VAR\(/);
  });

  it("warns against reading context directly", () => {
    expect(BUILTIN_SYSTEM_PROMPT.toLowerCase()).toContain("do not read");
  });
});
