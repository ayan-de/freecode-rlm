import { describe, it, expect } from "vitest";
import { VercelAIClient } from "./vercel-ai.js";
import { LMError } from "./types.js";

describe("VercelAIClient", () => {
  it("constructs with model name", () => {
    const c = new VercelAIClient({ model: "gpt-5-nano" });
    expect(c).toBeInstanceOf(VercelAIClient);
  });

  it("maps AI context-overflow errors to LMError with cause 'context_overflow'", () => {
    const c = new VercelAIClient({ model: "gpt-5-nano" });
    const mapped = (c as unknown as { mapError(err: unknown): LMError }).mapError(
      Object.assign(new Error("context length exceeded"), { name: "AIContextOverflowError" }),
    );
    expect(mapped).toBeInstanceOf(LMError);
    expect(mapped.cause).toBe("context_overflow");
    expect(mapped.retryable).toBe(false);
  });

  it("maps rate-limit (status 429) to retryable LMError", () => {
    const c = new VercelAIClient({ model: "gpt-5-nano" });
    const mapped = (c as unknown as { mapError(err: unknown): LMError }).mapError(
      Object.assign(new Error("rate limited"), { name: "Error", status: 429 }),
    );
    expect(mapped.cause).toBe("rate_limit");
    expect(mapped.retryable).toBe(true);
  });

  it("uses MINIMAX_API_KEY env var when apiKey option not provided", () => {
    const prev = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-key-from-env";
    try {
      const c = new VercelAIClient({ model: "gpt-5-nano" });
      expect((c as unknown as { apiKey: string }).apiKey).toBe("test-key-from-env");
    } finally {
      if (prev === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = prev;
    }
  });

  it("prefers opts.apiKey over env var", () => {
    const prev = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "env-key";
    try {
      const c = new VercelAIClient({ model: "gpt-5-nano", apiKey: "opts-key" });
      expect((c as unknown as { apiKey: string }).apiKey).toBe("opts-key");
    } finally {
      if (prev === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = prev;
    }
  });

  it("uses getApiKey callback when provided (e.g., for OAuth tokens)", async () => {
    let calls = 0;
    const c = new VercelAIClient({
      model: "gpt-5-nano",
      getApiKey: async () => {
        calls++;
        return "oauth-token-" + calls;
      },
    });
    const key1 = await (c as unknown as { resolveApiKey(): Promise<string> }).resolveApiKey();
    const key2 = await (c as unknown as { resolveApiKey(): Promise<string> }).resolveApiKey();
    expect(key1).toBe("oauth-token-1");
    expect(key2).toBe("oauth-token-2");
  });
});

describe("VercelAIClient (integration)", () => {
  const apiKey = process.env.MINIMAX_API_KEY;
  const baseURL = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const itIfKey = apiKey ? it : it.skip;

  // Plan-deviation: spec said `gpt-5-nano` (an OpenAI model) and no baseURL.
  // We use `MiniMax-M3` against the MiniMax OpenAI-compatible endpoint
  // because the API key is the project's MiniMax key. Behaviour assertion
  // is identical: a non-empty assistant reply that contains "ok".
  itIfKey("reaches the API and returns a non-empty assistant message", async () => {
    const c = new VercelAIClient({ model: "MiniMax-M3", apiKey, baseURL });
    const reply = await c.chat([{ role: "user", content: "Reply with the single word: OK" }]);
    expect(reply.role).toBe("assistant");
    expect(reply.content.toLowerCase()).toContain("ok");
  }, 30_000);
});
