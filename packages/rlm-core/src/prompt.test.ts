import { describe, it, expect } from "vitest";
import { BUILTIN_SYSTEM_PROMPT, buildSystemPrompt } from "./prompt.js";

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

  it("warns against bare top-level await and shows the async IIFE pattern", () => {
    expect(BUILTIN_SYSTEM_PROMPT.toLowerCase()).toContain("top-level");
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/async \(\) => \{/);
  });
});

describe("buildSystemPrompt", () => {
  it("omits bash/readFile/writeFile by default", () => {
    expect(buildSystemPrompt()).not.toMatch(/bash\(/);
  });

  it("mentions bash/readFile/writeFile when enableSystemTools is true", () => {
    const prompt = buildSystemPrompt({ enableSystemTools: true });
    expect(prompt).toMatch(/bash\(/);
    expect(prompt).toMatch(/readFile\(/);
    expect(prompt).toMatch(/writeFile\(/);
  });
});
