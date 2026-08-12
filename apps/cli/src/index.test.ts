import { describe, it, expect, vi } from "vitest";
import { run } from "./index.js";

describe("cli", () => {
  // No prompt argument now means "enter interactive mode" rather than a
  // usage error (see runInteractive in index.ts). The API key check still
  // runs first, so omitting both surfaces that error and exits 2.
  it("prints an API key error when no prompt/key is given and exits 2", async () => {
    const origKey = process.env.MINIMAX_API_KEY;
    const origHome = process.env.HOME;
    delete process.env.MINIMAX_API_KEY;
    // Point HOME at a dir with no ~/.freecode/config.json so the fallback
    // lookup also misses and the "no API key" path actually fires.
    process.env.HOME = "/nonexistent-freecode-rlm-test-home";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = await run([]);
      expect(code).toBe(2);
      expect(errSpy.mock.calls.flat().join(" ")).toContain("API key");
    } finally {
      errSpy.mockRestore();
      if (origKey !== undefined) process.env.MINIMAX_API_KEY = origKey;
      if (origHome !== undefined) process.env.HOME = origHome;
    }
  });
});