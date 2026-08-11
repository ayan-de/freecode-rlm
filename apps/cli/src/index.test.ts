import { describe, it, expect } from "vitest";
import { run } from "./index.js";

describe("cli", () => {
  it("prints usage error when no prompt is given and exits 2", async () => {
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // Capture stderr writes so we can assert on the user-facing error.
    (process.stderr as { write: typeof process.stderr.write }).write = ((
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ): boolean => {
      errs.push(typeof chunk === "string" ? chunk : chunk.toString());
      // Pass through to the real stream so test output stays visible.
      return (origWrite as (c: string | Uint8Array, ...rest: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    try {
      const code = await run([]);
      expect(code).toBe(2);
      expect(errs.join(" ")).toContain("prompt");
    } finally {
      (process.stderr as { write: typeof process.stderr.write }).write =
        origWrite;
    }
  });
});