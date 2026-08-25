import { describe, it, expect, vi, afterEach } from "vitest";
import { RLM } from "./rlm.js";
import { IsolatedVmREPL } from "@freecode-rs/repl";
import type { ChatMessage, LMClient } from "@freecode-rs/client";

class CapturingClient {
  responses: string[];
  calls = 0;
  lastMessages: ChatMessage[] = [];
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    this.lastMessages = messages;
    const content = this.responses[this.calls++] ?? "FINAL('done')";
    return { role: "assistant", content };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SERPER_API_KEY;
});

describe("RLM with skills", () => {
  it("installs a skill and lets the REPL call it", async () => {
    process.env.SERPER_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          organic: [{ title: "Result One", link: "https://r1", snippet: "first snippet" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const repl = new IsolatedVmREPL();
    const skill = {
      name: "websearch",
      description: "Search Google via Serper.",
      run: async (...args: unknown[]) => {
        // Re-import the run() so we exercise the same code path
        const mod = await import("@freecode-rs/skill-websearch");
        return mod.run(args[0] as string);
      },
    };
    const client = new CapturingClient([
      "```repl\n(async () => { const out = await websearch.run('hello'); FINAL(out); })()\n```",
    ]) as unknown as LMClient;
    const rlm = new RLM({ client, repl, skills: [skill] });
    const result = await rlm.completion("find something");
    expect(result.response).toContain("Result One");
    expect(result.response).toContain("https://r1");
    await repl.dispose();
  });

  it("lists installed skills in the system prompt", async () => {
    const repl = new IsolatedVmREPL();
    const skill = { name: "websearch", description: "Search Google.", run: async () => "" };
    const client = new CapturingClient(["```repl\nFINAL('ok')\n```"]) as unknown as LMClient;
    const rlm = new RLM({ client, repl, skills: [skill] });
    await rlm.completion("ignore");
    const sys = (client as unknown as CapturingClient).lastMessages[0]?.content as string;
    expect(sys).toContain("Installed skills");
    expect(sys).toContain("websearch");
    await repl.dispose();
  });
});