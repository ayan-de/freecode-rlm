import { describe, it, expect } from "vitest";
import { run } from "./index.js";

describe("cli", () => {
  it("prints 'ready' and exits 0", async () => {
    const out: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
    try {
      const code = await run([]);
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("ready");
    } finally {
      console.log = orig;
    }
  });
});
