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
    out.push({
      role: "user",
      content: `Assistant turn:\n${it.assistantMessage.content}\n\nResult:\n${formatResult(it)}`,
    });
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
