import { describe, it, expect, vi, afterEach } from "vitest";
import { run, name, description } from "./websearch.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SERPER_API_KEY;
});

describe("websearch skill", () => {
  it("exports name and description", () => {
    expect(name).toBe("websearch");
    expect(description).toContain("Serper");
  });

  it("returns a friendly message when no API key is set", async () => {
    delete process.env.SERPER_API_KEY;
    const out = await run("anything");
    expect(out).toContain("no SERPER_API_KEY");
    expect(out).toContain("serper.dev");
  });

  it("returns formatted results on a successful response", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          knowledgeGraph: { title: "Graph Title", description: "Graph Desc", attributes: { Founder: "Ada" } },
          organic: [
            { title: "First", link: "https://1", snippet: "one" },
            { title: "Second", link: "https://2", snippet: "two" },
          ],
          peopleAlsoAsk: [{ question: "Why?", snippet: "Because." }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await run("hello");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(out).toContain("Results for query \"hello\"");
    expect(out).toContain("Knowledge Graph: Graph Title");
    expect(out).toContain("Founder: Ada");
    expect(out).toContain("Result 0: First");
    expect(out).toContain("URL: https://1");
    expect(out).toContain("People Also Ask:");
    expect(out).toContain("Q: Why?");
  });

  it("returns an error string on non-2xx responses", async () => {
    process.env.SERPER_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const out = await run("hello");
    expect(out).toMatch(/Serper search error \(429\)/);
  });

  it("returns an error string on fetch abort", async () => {
    process.env.SERPER_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aborted"));
    const out = await run("hello");
    expect(out).toContain("Error searching for \"hello\"");
    expect(out).toContain("aborted");
  });

  it("truncates very long output to maxOutput chars", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const big = "x".repeat(20_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ organic: [{ title: "Big", link: "https://1", snippet: big }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await run("hello", { maxOutput: 2000 });
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain("output truncated");
  });

  it("returns 'No results' when Serper returns empty", async () => {
    process.env.SERPER_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const out = await run("nothing");
    expect(out).toContain("No results returned");
  });
});
