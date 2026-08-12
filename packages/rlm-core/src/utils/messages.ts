import type { ChatMessage } from "@freecode-rs/client";
import type { Iteration } from "../types.js";

export function buildHistoryMessages(args: {
  systemPrompt: string;
  // Prior turns' messages (as returned by a previous RLMResult.messages),
  // spliced in between the system prompt and this turn's user prompt so a
  // caller can carry a multi-turn conversation forward.
  history?: ChatMessage[];
  userPrompt: string;
  iterations: Iteration[];
}): ChatMessage[] {
  const out: ChatMessage[] = [
    { role: "system", content: args.systemPrompt },
    ...(args.history ?? []),
    { role: "user", content: args.userPrompt },
  ];
  for (const it of args.iterations) {
    // The model's own prior reply must stay role:"assistant" — folding it
    // into a role:"user" wrapper (as this used to do) makes the model see
    // its own past words as something the user said, and once multi-turn
    // history accumulates several of these it loses track of which
    // "user" message is a real instruction vs. REPL-result feedback.
    // No native tool-result role is available here (plain chat completion,
    // no structured tool-calling), so the REPL result stays role:"user"
    // but is now clearly separated from — not merged with — the model's text.
    out.push({ role: "assistant", content: it.assistantMessage.content });
    out.push({ role: "user", content: `[REPL result]\n${formatResult(it)}` });
  }
  return out;
}

function formatResult(it: Iteration): string {
  if (!it.replResult.success) {
    return `error: ${it.replResult.error?.message ?? "unknown"}\ntrace: ${it.replResult.error?.trace ?? ""}`;
  }
  const stdout = it.replResult.stdout.join("\n");
  const expr = JSON.stringify(it.replResult.expression);
  return `stdout:\n${stdout}\nexpression: ${expr}`;
}
