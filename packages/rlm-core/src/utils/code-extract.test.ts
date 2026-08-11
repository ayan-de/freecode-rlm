import { describe, it, expect } from "vitest";
import { extractReplCode } from "./code-extract.js";

describe("extractReplCode", () => {
  it("returns the contents of the last ```repl block", () => {
    const text = "intro\n```repl\nconsole.log('a');\n42\n```\noutro";
    expect(extractReplCode(text)).toBe("console.log('a');\n42");
  });

  it("returns the last fenced block if no language hint", () => {
    const text = "```\nlet x = 1;\n```";
    expect(extractReplCode(text)).toBe("let x = 1;");
  });

  it("returns null when no code blocks present", () => {
    expect(extractReplCode("plain text only")).toBeNull();
  });

  it("takes the LAST block when multiple are present", () => {
    const text = "```repl\nfirst\n```\nmid\n```repl\nsecond\n```";
    expect(extractReplCode(text)).toBe("second");
  });
});
