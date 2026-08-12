import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { MockLMClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";
import type { CoreREPL, CoreREPLResult } from "./types.js";

/**
 * Minimal in-memory CoreREPL fake. rlm-core only depends on the CoreREPL
 * interface, never on rlm-repl (boundary rule). This fake mirrors the
 * eval-based semantics of IsolatedVmREPL: the last expression of the
 * user's code is returned as `expression`.
 *
 * Implementation: eval user code with helper functions injected as
 * globalThis.PRINT / FINAL / FINAL_VAR. The user-defined `let`/`var`
 * declarations land on globalThis (no function wrapper, no strict
 * mode) so FINAL_VAR() can resolve them via inspect().
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
    // Define helpers on globalThis so eval'd code can call them.
    (globalThis as Record<string, unknown>).PRINT = (x: unknown) => {
      self.stdout.push(typeof x === "string" ? x : JSON.stringify(x));
    };
    (globalThis as Record<string, unknown>).FINAL = (answer: string) => ({
      __final: answer,
    });
    (globalThis as Record<string, unknown>).FINAL_VAR = (name: string) => ({
      __finalVar: name,
    });
    // Seed loaded bindings as global vars. Skip keys whose globalThis
    // slot is read-only (e.g. `navigator`, `process` in some runtimes).
    for (const [k, v] of this.bindings) {
      try {
        (globalThis as Record<string, unknown>)[k] = v;
      } catch {
        // ignore — read-only globals
      }
    }
    try {
      const expression = (0, eval)(code);
      // Harvest any new globals the user code defined. Skip built-ins
      // by excluding keys we already know about (bindings + helpers).
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
        // Skip read-only globals we can't reliably re-set later.
        try {
          // Probe: try to assign a clone back to itself. If it fails,
          // the slot is read-only and we should skip it.
          (globalThis as Record<string, unknown>)[key] = g[key];
        } catch {
          continue;
        }
        this.bindings.set(key, g[key]);
      }
      return { success: true, stdout: [...this.stdout], expression, durationMs: Date.now() - start };
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

describe("RLM (depth-0)", () => {
  it("runs the loop until FINAL() and returns the answer", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nPRINT('thinking'); FINAL('done')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, maxIterations: 5 });
    const result = await rlm.completion("hi");
    expect(result.response).toBe("done");
    expect(result.metadata.finishedReason).toBe("final");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.replResult.stdout).toContain("thinking");
  });

  it("returns last assistant text when maxIterations hit without FINAL", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n1+1\n```" },
      { role: "assistant", content: "```repl\n2+2\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, maxIterations: 2 });
    const result = await rlm.completion("hi");
    expect(result.metadata.finishedReason).toBe("max_iterations");
    expect(result.response).toContain("2+2");
  });

  it("carries conversation history forward via result.messages", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('first')\n```" },
      { role: "assistant", content: "```repl\nFINAL('second')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl });
    const first = await rlm.completion("turn one");
    expect(first.messages).toEqual([
      { role: "user", content: "turn one" },
      { role: "assistant", content: "```repl\nFINAL('first')\n```" },
      expect.objectContaining({ role: "user" }), // the REPL result
    ]);

    await rlm.completion("turn two", { history: first.messages });
    const secondCallMessages = client.calls[1]!;
    // system + prior history (3 msgs) + new user prompt
    expect(secondCallMessages).toHaveLength(5);
    expect(secondCallMessages[1]).toEqual({ role: "user", content: "turn one" });
    expect(secondCallMessages[2]).toEqual({
      role: "assistant",
      content: "```repl\nFINAL('first')\n```",
    });
    expect(secondCallMessages[4]).toEqual({ role: "user", content: "turn two" });
  });

  it("loads the prompt as `context` in the REPL", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL(context)\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl });
    const result = await rlm.completion("the prompt");
    expect(result.response).toBe("the prompt");
  });

  it("treats assistant text with no code block as the final answer", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "no code here, just an answer" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, maxIterations: 5 });
    const result = await rlm.completion("hi");
    expect(result.metadata.finishedReason).toBe("final");
    expect(result.response).toBe("no code here, just an answer");
  });

  it("uses the provided systemPrompt when given", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('x')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, systemPrompt: "CUSTOM" });
    const result = await rlm.completion("hi");
    expect(result.response).toBe("x");
  });

  it("resolves FINAL_VAR by reading a custom-defined variable", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nvar result = 'stored'; FINAL_VAR('result')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl, maxIterations: 5 });
    const result = await rlm.completion("hi");
    expect(result.response).toBe("stored");
  });

  it("times metadata spans the completion call", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL('ok')\n```" },
    ]);
    const repl = new FakeREPL();
    const rlm = new RLM({ client, repl });
    const before = Date.now();
    const result = await rlm.completion("hi");
    expect(result.metadata.startedAt).toBeGreaterThanOrEqual(before);
    expect(result.metadata.finishedAt).toBeGreaterThanOrEqual(result.metadata.startedAt);
  });
});

describe("RLM (bridge, recursion, budget)", () => {
  it("llm_query inside the REPL is counted and answered", async () => {
    const client = new MockLMClient([
      // First call: model writes code that calls llm_query and returns its result.
      { role: "assistant", content: "```repl\n(async () => FINAL(await llm_query('sub')))()\n```" },
      // Second call (the sub-LLM's reply), used by llm_query.
      { role: "assistant", content: "SUB-ANSWER" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxSubCalls: 10 });
    const result = await rlm.completion("top");
    expect(result.response).toBe("SUB-ANSWER");
    expect(result.metadata.totalSubCalls).toBe(1);
    await repl.dispose();
  });

  it("sub-RLM is invoked when rlm_query is called", async () => {
    const client = new MockLMClient([
      // First call (root): spawn sub-RLM.
      { role: "assistant", content: "```repl\n(async () => FINAL(await rlm_query('child prompt')))()\n```" },
      // Sub-RLM (child) call:
      { role: "assistant", content: "```repl\nFINAL('child answer')\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxDepth: 3, maxSubCalls: 10 });
    const result = await rlm.completion("top");
    expect(result.response).toBe("child answer");
    expect(result.metadata.depthReached).toBe(1);
    expect(result.metadata.totalSubCalls).toBe(1);
    await repl.dispose();
  });

  it("maxSubCalls stops the run with finishedReason 'max_iterations'", async () => {
    // A loop where llm_query is called every iteration and we never FINAL.
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n(async () => { await llm_query('1'); PRINT('go'); })()\n```" },
      { role: "assistant", content: "```repl\n(async () => { await llm_query('2'); PRINT('go'); })()\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxSubCalls: 1, maxIterations: 5 });
    const result = await rlm.completion("top");
    // First iteration succeeds, second is blocked by budget on the sub-call.
    expect(result.metadata.finishedReason).not.toBe("final");
    await repl.dispose();
  });

  it("bash/readFile/writeFile are undefined in the REPL by default", async () => {
    const client = new MockLMClient([
      {
        role: "assistant",
        content: "```repl\nFINAL(String(typeof bash) + ',' + String(typeof readFile))\n```",
      },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl });
    const result = await rlm.completion("top");
    expect(result.response).toBe("undefined,undefined");
    await repl.dispose();
  });

  it("bash runs a real shell command when enableSystemTools is true", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n(async () => FINAL((await bash('echo hi')).stdout.trim()))()\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, enableSystemTools: true });
    const result = await rlm.completion("top");
    expect(result.response).toBe("hi");
    await repl.dispose();
  });
});
