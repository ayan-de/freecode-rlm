import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { VercelAIClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

function buildHaystack(secret: string, approxLines: number): string {
  const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "elit", "sed"];
  const lines: string[] = [];
  // Insert secret near the middle.
  const middle = Math.floor(approxLines / 2);
  for (let i = 0; i < approxLines; i++) {
    if (i === middle) lines.push(`secret-token: ${secret}`);
    let line = "";
    for (let j = 0; j < 12; j++) {
      line += words[(i * 31 + j * 7) % words.length] + " ";
    }
    lines.push(line.trim());
  }
  return lines.join("\n");
}

describe("RLM needle-in-the-haystack (requires MINIMAX_API_KEY)", () => {
  const apiKey = process.env.MINIMAX_API_KEY;
  const baseURL = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  const itIfKey = apiKey ? it : it.skip;

  // Plan-deviation: spec used `model: "gpt-5-nano"` with `OPENAI_API_KEY`.
  // We use MiniMax-M3 against the MiniMax OpenAI-compatible endpoint and
  // skip when MINIMAX_API_KEY is unset. See Task 12 commit for the same
  // rationale.
  itIfKey(
    "finds a random number hidden in ~50k lines of random text",
    async () => {
      const secret = String(Math.floor(Math.random() * 1_000_000));
      const context = buildHaystack(secret, 50_000);
      const client = new VercelAIClient({ model: "MiniMax-M3", apiKey, baseURL });
      const repl = new IsolatedVmREPL();
      try {
        const rlm = new RLM({
          client,
          repl,
          maxIterations: 15,
          maxSubCalls: 20,
          verbose: !!process.env.RLM_NIAH_DEBUG,
        });
        const result = await rlm.completion(
          "Find the secret token in the context. Reply with ONLY the token value.",
          { context },
        );
        if (process.env.RLM_NIAH_DEBUG) {
          // Surface what actually happened for live-run debugging.
          console.error("[niah debug] finishedReason:", result.metadata.finishedReason);
          console.error("[niah debug] iterations:", result.iterations.length);
          console.error("[niah debug] final response:", JSON.stringify(result.response));
          console.error(
            "[niah debug] last assistant:",
            JSON.stringify(result.iterations.at(-1)?.assistantMessage.content),
          );
        }
        expect(result.response.trim()).toContain(secret);
      } finally {
        await repl.dispose();
      }
    },
    180_000,
  );
});
