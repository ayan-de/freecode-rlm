import { describe, it, expect } from "vitest";
import type { Iteration } from "./types.js";
import {
  buildSummaryPrompt,
  compactIterations,
  DEFAULT_COMPACTION_OPTIONS,
  estimateIterationTokens,
  estimateIterationsTokens,
  findCutPoint,
  shouldCompact,
} from "./compaction.js";

/**
 * Build a synthetic Iteration. `contentLen` controls the assistant
 * message length; `stdout` controls the REPL result; pass
 * `success: false` to flip into the error path. Token math uses
 * chars/4, so any predictable length works.
 */
function makeIteration(args: {
  contentLen: number;
  stdout?: string[];
  expression?: unknown;
  success?: boolean;
  error?: { name: string; message: string; trace: string };
}): Iteration {
  const success = args.success ?? true;
  return {
    index: 0,
    assistantMessage: { role: "assistant", content: "a".repeat(args.contentLen) },
    replResult: success
      ? {
          success: true,
          stdout: args.stdout ?? [],
          expression: args.expression,
          durationMs: 0,
        }
      : {
          success: false,
          stdout: [],
          error: args.error ?? { name: "Error", message: "boom", trace: "trace" },
          durationMs: 0,
        },
    subCallsAtStart: 0,
  };
}

describe("estimateIterationTokens", () => {
  it("returns ceil(chars/4) for an assistant message + stdout", () => {
    // 12 chars assistant + 8 chars stdout = 20 chars / 4 = 5 tokens.
    const it = makeIteration({ contentLen: 12, stdout: ["12345678"] });
    expect(estimateIterationTokens(it)).toBe(5);
  });

  it("includes JSON-stringified expression in the char count", () => {
    // 4 chars assistant + JSON.stringify({x:1})="{"x":1}"=7 chars,
    // total 11 chars, 11/4 = 2.75 → 3 tokens.
    const it = makeIteration({
      contentLen: 4,
      expression: { x: 1 },
    });
    expect(estimateIterationTokens(it)).toBe(3);
  });

  it("falls back to error.message + error.trace for failed iterations", () => {
    const it = makeIteration({
      contentLen: 4,
      success: false,
      error: { name: "Error", message: "0123456789", trace: "012345" }, // 10 + 6 = 16 chars
    });
    // 4 + 16 = 20 / 4 = 5 tokens.
    expect(estimateIterationTokens(it)).toBe(5);
  });
});

describe("estimateIterationsTokens", () => {
  it("sums per-iteration estimates", () => {
    const a = makeIteration({ contentLen: 12, stdout: ["12345678"] }); // 5
    const b = makeIteration({ contentLen: 4 }); // 1
    expect(estimateIterationsTokens([a, b])).toBe(6);
  });

  it("returns 0 for an empty array", () => {
    expect(estimateIterationsTokens([])).toBe(0);
  });
});

describe("shouldCompact", () => {
  it("returns false when projected tokens are well under the limit", () => {
    // 4 iters of 100 tokens each = 400. contextWindow 1000, reserve 100.
    // Threshold is 1000 - 100 = 900. 400 < 900 → no compaction.
    const iters = Array.from({ length: 4 }, () =>
      makeIteration({ contentLen: 400 }), // 100 tokens
    );
    expect(shouldCompact(iters, { contextWindow: 1000, reserveTokens: 100 })).toBe(false);
  });

  it("returns true when projected tokens exceed (window - reserve)", () => {
    // 20 iters of 100 tokens = 2000. contextWindow 1000, reserve 100.
    // Threshold is 900. 2000 > 900 → compact.
    const iters = Array.from({ length: 20 }, () =>
      makeIteration({ contentLen: 400 }),
    );
    expect(shouldCompact(iters, { contextWindow: 1000, reserveTokens: 100 })).toBe(true);
  });

  it("counts the extraTokens framing allowance against the budget", () => {
    // 9 iters of 100 tokens = 900. contextWindow 1000, reserve 200.
    // Threshold is 800. Without extra, 900 > 800 → would compact.
    // With extra=200, total=1100, still 1100 > 800. Same answer.
    // But with extra=0 and 700 tokens total, 700 < 800 → no compact;
    // prove extraTokens shifts the answer.
    const iters = Array.from({ length: 7 }, () =>
      makeIteration({ contentLen: 400 }),
    );
    expect(shouldCompact(iters, { contextWindow: 1000, reserveTokens: 200 }, 0)).toBe(false);
    // extra=400 → projected becomes 700 + 400 = 1100 > 800 → compact.
    expect(shouldCompact(iters, { contextWindow: 1000, reserveTokens: 200 }, 400)).toBe(true);
  });

  it("returns false when contextWindow is 0 (caller opted out)", () => {
    const iters = Array.from({ length: 100 }, () => makeIteration({ contentLen: 400 }));
    expect(shouldCompact(iters, { contextWindow: 0 })).toBe(false);
  });
});

describe("findCutPoint", () => {
  it("returns 0 when the entire history fits in keepRecentTokens", () => {
    // 4 iters of 10 tokens each = 40. keepRecent 100. Should keep all.
    const iters = Array.from({ length: 4 }, () => makeIteration({ contentLen: 40 }));
    expect(findCutPoint(iters, { keepRecentTokens: 100, minRecentIterations: 1 })).toBe(0);
  });

  it("keeps the most-recent iterations up to keepRecentTokens", () => {
    // 10 iters of 100 tokens each. keepRecent 250. Walking back from
    // the end: 100+100+100=300, so the cut point is 10-3=7 (keep
    // iterations 7,8,9 which total 300 tokens, the smallest window
    // meeting the budget).
    const iters = Array.from({ length: 10 }, () => makeIteration({ contentLen: 400 }));
    expect(findCutPoint(iters, { keepRecentTokens: 250, minRecentIterations: 1 })).toBe(7);
  });

  it("respects minRecentIterations even if it overshoots the budget", () => {
    // 3 iters of 1000 tokens each. keepRecent 100 (would keep 1).
    // minRecentIterations 2 → must keep at least 2.
    const iters = Array.from({ length: 3 }, () => makeIteration({ contentLen: 4000 }));
    expect(findCutPoint(iters, { keepRecentTokens: 100, minRecentIterations: 2 })).toBe(1);
  });

  it("returns 0 when the array is shorter than minRecentIterations", () => {
    const iters = [makeIteration({ contentLen: 4000 })];
    expect(findCutPoint(iters, { keepRecentTokens: 100, minRecentIterations: 5 })).toBe(0);
  });
});

describe("buildSummaryPrompt", () => {
  it("includes the structured sections the model is expected to fill in", () => {
    const prompt = buildSummaryPrompt({ totalIterations: 12, compactionCount: 1 });
    for (const section of [
      "## Goal",
      "## Constraints & Preferences",
      "## Progress",
      "### Done",
      "### In progress",
      "### Not started",
      "## Current State",
      "## Next Steps",
    ]) {
      expect(prompt).toContain(section);
    }
  });

  it("mentions the compaction count and total iteration count", () => {
    const prompt = buildSummaryPrompt({ totalIterations: 27, compactionCount: 2 });
    expect(prompt).toContain("compaction #2");
    expect(prompt).toContain("27 iterations");
  });
});

describe("compactIterations", () => {
  it("produces [summary, ...recent] and records iterationsReplaced", async () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration({ contentLen: 400, stdout: [`iter-${i}`] }),
    );
    const result = await compactIterations(
      iters,
      { keepRecentTokens: 250, minRecentIterations: 1 }, // cutPoint=3, keep last 3
      async () => "## Goal\nx\n## Progress\n- [x] did stuff\n## Next Steps\n1. keep going",
      { compactionCount: 1 },
    );
    expect(result.iterationsReplaced).toBe(3);
    expect(result.newIterations).toHaveLength(4); // 1 summary + 3 recent
    expect(result.newIterations[0]!.assistantMessage.content).toContain("## Goal");
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("passes the dropped transcript + summary prompt to the summarizer", async () => {
    const iters = [
      makeIteration({ contentLen: 40, stdout: ["A1"] }),
      makeIteration({ contentLen: 40, stdout: ["B1"] }),
      makeIteration({ contentLen: 40, stdout: ["C1"] }),
    ];
    let captured = "";
    await compactIterations(
      iters,
      { keepRecentTokens: 5, minRecentIterations: 1 }, // cutPoint=2
      async (prompt) => {
        captured = prompt;
        return "summary";
      },
      { compactionCount: 1 },
    );
    // The summary prompt must include the dropped iterations' content
    // and stdout so the model can act on them.
    expect(captured).toContain("A1");
    expect(captured).toContain("B1");
    expect(captured).not.toContain("C1");
    // And it must include the structured prompt scaffold.
    expect(captured).toContain("## Goal");
  });

  it("no-ops when nothing is eligible for compaction (returns the same array)", async () => {
    const iters = [makeIteration({ contentLen: 40 })];
    const result = await compactIterations(
      iters,
      { keepRecentTokens: 100, minRecentIterations: 1 },
      async () => {
        throw new Error("summarizer should not be called");
      },
      { compactionCount: 1 },
    );
    expect(result.iterationsReplaced).toBe(0);
    // We return a slice, not the original — content must be equal
    // (no summary injected), but the reference is a fresh array.
    expect(result.newIterations).toEqual(iters);
  });
});

describe("DEFAULT_COMPACTION_OPTIONS", () => {
  it("matches the documented defaults", () => {
    expect(DEFAULT_COMPACTION_OPTIONS).toEqual({
      contextWindow: 200_000,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
      minRecentIterations: 1,
      maxCompactions: 3,
    });
  });
});
