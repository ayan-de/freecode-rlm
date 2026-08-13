import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { MockLMClient } from "@freecode-rs/client";
import type { ChatMessage } from "@freecode-rs/client";
import type { CoreREPL, CoreREPLResult } from "./types.js";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";

/**
 * Tiny in-memory CoreREPL fake. Mirrors IsolatedVmREPL's helpers via
 * globalThis injection — enough for these tests to drive the loop
 * without spinning up an actual V8 isolate.
 *
 * Implementation note: inlined here (rather than imported from
 * rlm.test.ts) so the test runner doesn't execute the unit suite
 * twice when both files match the same vitest glob.
 */
class FakeREPL implements CoreREPL {
  private bindings = new Map<string, unknown>();
  private stdout: string[] = [];

  async load(name: string, value: unknown): Promise<void> {
    this.bindings.set(name, value);
  }

  async execute(
    code: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _opts?: { timeoutMs?: number },
  ): Promise<CoreREPLResult> {
    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    (globalThis as Record<string, unknown>).PRINT = (x: unknown) => {
      self.stdout.push(typeof x === "string" ? x : JSON.stringify(x));
    };
    (globalThis as Record<string, unknown>).FINAL = (answer: string) => ({
      __final: answer,
    });
    (globalThis as Record<string, unknown>).FINAL_VAR = (name: string) => ({
      __finalVar: name,
    });
    for (const [k, v] of this.bindings) {
      try {
        (globalThis as Record<string, unknown>)[k] = v;
      } catch {
        // read-only globals
      }
    }
    try {
      const expression = (0, eval)(code);
      const known = new Set([
        ...this.bindings.keys(),
        "PRINT",
        "FINAL",
        "FINAL_VAR",
      ]);
      const g = globalThis as Record<string, unknown>;
      for (const key of Object.keys(g)) {
        if (known.has(key)) continue;
        if (key === "globalThis" || key === "self" || key === "window") continue;
        if (typeof g[key] === "function") continue;
        try {
          (globalThis as Record<string, unknown>)[key] = g[key];
        } catch {
          continue;
        }
        this.bindings.set(key, g[key]);
      }
      return {
        success: true,
        stdout: [...this.stdout],
        expression,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const e = err as Error;
      return {
        success: false,
        stdout: [...this.stdout],
        durationMs: Date.now() - start,
        error: { name: e.name, message: e.message, trace: e.stack ?? "" },
      };
    }
  }

  readStdout(): string[] {
    return [...this.stdout];
  }

  async inspect(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.bindings);
  }

  async dispose(): Promise<void> {
    this.bindings.clear();
    this.stdout = [];
  }
}

/**
 * Scripted LMClient that also detects summarization calls (fingerprint
 * = prompt includes both "## Goal" and "compaction #") and returns a
 * canned summary, capturing what the summarizer was given for
 * assertion in tests.
 */
class CompactionScriptedClient {
  readonly summarizerCalls: string[] = [];
  private queue: ChatMessage[];
  // Long assistant content emitted once we run out of scripted
  // responses — large enough per iteration to drive `shouldCompact`
  // past a small threshold. The cost in test-runtime characters is
  // worth the determinism.
  private repeatContentChars = 4000;

  constructor(scripted: ChatMessage[]) {
    this.queue = scripted.slice();
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    const last = messages[messages.length - 1]!.content as string;
    if (last.includes("## Goal") && last.includes("compaction #")) {
      this.summarizerCalls.push(last);
      return {
        role: "assistant",
        content: "## Goal\nfinish the task\n## Progress\n- [x] working\n## Next Steps\n1. continue",
      };
    }
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    // Long content + a long REPL stdout (long because FakeREPL
    // accumulates stdout across iterations) → easily drives the
    // token estimate past any small threshold.
    const longBody = "x".repeat(this.repeatContentChars);
    return {
      role: "assistant",
      content: `\`\`\`repl\nPRINT('repeating-${longBody}')\n\`\`\``,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<{
    kind: "final";
    message: ChatMessage;
  }> {
    const final = await this.chat(messages);
    yield { kind: "final", message: final };
  }
}

describe("RLM completion with compaction", () => {
  it("does not run compaction when disabled (default)", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('done')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, maxIterations: 5 });
    const result = await rlm.completion("hi");
    expect(result.metadata.compactionEvents).toEqual([]);
  });

  it("compactionEvents is always present (even when empty) in metadata", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('done')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl });
    const result = await rlm.completion("hi");
    expect(Array.isArray(result.metadata.compactionEvents)).toBe(true);
  });

  it("still runs the loop normally when compaction is configured but never triggers", async () => {
    // Compaction enabled but threshold is huge — never trips.
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('untouched')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({
      client,
      repl,
      maxIterations: 5,
      compaction: { contextWindow: 1_000_000, reserveTokens: 0, enabled: true },
    });
    const result = await rlm.completion("hi");
    expect(result.response).toBe("untouched");
    expect(result.metadata.compactionEvents).toEqual([]);
  });

  it("triggers compaction when projected tokens exceed threshold and replaces prefix with summary", async () => {
    const scriptedClient = new CompactionScriptedClient([
      // 5 leading iterations; per-iteration assistant content is small
      // (~20 chars) but the FakeREPL accumulates stdout across them, so
      // each subsequent iteration carries more. With contextWindow=400
      // the system prompt (~580 chars ≈ 145 tokens) + a few iterations
      // trips the trigger, and keepRecent=5 ensures findCutPoint has
      // iterations to drop (otherwise the swap would be a no-op).
      { role: "assistant", content: "```repl\nPRINT('A')\n```" },
      { role: "assistant", content: "```repl\nPRINT('B')\n```" },
      { role: "assistant", content: "```repl\nPRINT('C')\n```" },
      { role: "assistant", content: "```repl\nPRINT('D')\n```" },
      { role: "assistant", content: "```repl\nFINAL('done')\n```" },
    ]);

    const repl = new FakeREPL();
    const rlm = new RLM({
      client: scriptedClient as unknown as ConstructorParameters<typeof RLM>[0]["client"],
      repl,
      maxIterations: 6,
      compaction: {
        contextWindow: 400,
        reserveTokens: 0,
        keepRecentTokens: 5, // < per-iteration cost so cutPoint > 0
        minRecentIterations: 1,
        maxCompactions: 5,
        enabled: true,
      },
    });
    const result = await rlm.completion("hi");

    // Compaction fired at least once.
    expect(result.metadata.compactionEvents.length).toBeGreaterThanOrEqual(1);
    // The summarizer was called.
    expect(scriptedClient.summarizerCalls.length).toBeGreaterThanOrEqual(1);
    // And the messages projection contains the canned summary text
    // (proving the summary iteration replaced the dropped prefix).
    const allText = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(allText).toContain("finish the task");
  });

  it("caps successful compactions at maxCompactions", async () => {
    // Same trajectory but maxCompactions=1. After the first swap,
    // the compacted history is still big enough to trip again — but
    // we should refuse to compact more than once.
    const scriptedClient = new CompactionScriptedClient([
      { role: "assistant", content: "```repl\nPRINT('A')\n```" },
      { role: "assistant", content: "```repl\nPRINT('B')\n```" },
      { role: "assistant", content: "```repl\nPRINT('C')\n```" },
      { role: "assistant", content: "```repl\nPRINT('D')\n```" },
      { role: "assistant", content: "```repl\nFINAL('done')\n```" },
    ]);

    const repl = new FakeREPL();
    const rlm = new RLM({
      client: scriptedClient as unknown as ConstructorParameters<typeof RLM>[0]["client"],
      repl,
      maxIterations: 6,
      compaction: {
        contextWindow: 400,
        reserveTokens: 0,
        keepRecentTokens: 5,
        minRecentIterations: 1,
        maxCompactions: 1,
        enabled: true,
      },
    });
    const result = await rlm.completion("hi");
    expect(result.metadata.compactionEvents.length).toBeLessThanOrEqual(1);
  });

  it("a summarizer failure does not crash the loop and produces no events", async () => {
    const failingClient = {
      async chat(messages: ChatMessage[]): Promise<ChatMessage> {
        const last = messages[messages.length - 1]!.content as string;
        if (last.includes("## Goal") && last.includes("compaction #")) {
          throw new Error("summarizer exploded");
        }
        return {
          role: "assistant",
          content: "```repl\nPRINT('A')\n```",
        };
      },
      async *stream(messages: ChatMessage[]): AsyncIterable<{
        kind: "final";
        message: ChatMessage;
      }> {
        const final = await this.chat(messages);
        yield { kind: "final", message: final };
      },
    };
    const repl = new FakeREPL();
    const rlm = new RLM({
      client: failingClient as unknown as ConstructorParameters<typeof RLM>[0]["client"],
      repl,
      maxIterations: 6,
      compaction: {
        contextWindow: 400,
        reserveTokens: 0,
        keepRecentTokens: 50,
        minRecentIterations: 1,
        maxCompactions: 3,
        enabled: true,
      },
    });
    const result = await rlm.completion("hi");
    expect(result.metadata.finishedReason).toBeDefined();
    // The summarizer kept failing — no successful swaps, so events empty.
    expect(result.metadata.compactionEvents).toEqual([]);
  });

  it("does not invoke the summarizer for a no-op compaction", async () => {
    // contextWindow small enough that shouldCompact fires every iteration,
    // but keepRecent big enough that findCutPoint returns 0 every time
    // — the bail-out inside compactIterations now skips the LM call.
    const scriptedClient = new CompactionScriptedClient([
      { role: "assistant", content: "```repl\nPRINT('A')\n```" },
      { role: "assistant", content: "```repl\nPRINT('B')\n```" },
      { role: "assistant", content: "```repl\nPRINT('C')\n```" },
      { role: "assistant", content: "```repl\nFINAL('done')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({
      client: scriptedClient as unknown as ConstructorParameters<typeof RLM>[0]["client"],
      repl,
      maxIterations: 5,
      compaction: {
        contextWindow: 100, // trigger fires often
        reserveTokens: 0,
        keepRecentTokens: 100_000, // but everything fits → no-op
        minRecentIterations: 1,
        maxCompactions: 3,
        enabled: true,
      },
    });
    const result = await rlm.completion("hi");
    expect(result.metadata.compactionEvents).toEqual([]);
    // Summarizer should not have been called either, since the no-op
    // bail-out happens before invoking it.
    expect(scriptedClient.summarizerCalls).toEqual([]);
  });
});

// Sanity: the system prompt must be substantial enough to be a real
// component of the framing-budget. If BUILTIN_SYSTEM_PROMPT ever
// shrinks to a trivial stub, several compaction tests would become
// meaningless noise.
it("BUILTIN_SYSTEM_PROMPT is non-trivial (drives framing math)", () => {
  expect(BUILTIN_SYSTEM_PROMPT.length).toBeGreaterThan(500);
});
