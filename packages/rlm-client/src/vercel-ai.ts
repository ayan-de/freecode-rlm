import { generateText, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ChatEvent, ChatMessage, LMClient } from "./types.js";
import { LMError, type LMErrorCause } from "./types.js";

export type ApiKeyResolver = () => string | Promise<string>;

export interface VercelAIClientOptions {
  model: string;
  apiKey?: string;
  baseURL?: string;
  getApiKey?: ApiKeyResolver;
}

export class VercelAIClient implements LMClient {
  readonly apiKey: string;
  private readonly baseURL?: string;
  private readonly modelName: string;
  private readonly getApiKey?: ApiKeyResolver;

  constructor(opts: VercelAIClientOptions) {
    this.apiKey = opts.apiKey ?? process.env.MINIMAX_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    this.baseURL = opts.baseURL;
    this.modelName = opts.model;
    this.getApiKey = opts.getApiKey;
  }

  async resolveApiKey(): Promise<string> {
    if (this.getApiKey) return this.getApiKey();
    return this.apiKey;
  }

  private makeProvider(key: string) {
    return createOpenAI({ apiKey: key, baseURL: this.baseURL });
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    try {
      const key = await this.resolveApiKey();
      const { text } = await generateText({
        model: this.makeProvider(key)(this.modelName),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return { role: "assistant", content: text };
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatEvent> {
    let finalText = "";
    try {
      const key = await this.resolveApiKey();
      const result = streamText({
        model: this.makeProvider(key)(this.modelName),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      for await (const part of result.textStream) {
        finalText += part;
        yield { kind: "delta", text: part };
      }
      yield { kind: "final", message: { role: "assistant", content: finalText } };
    } catch (e) {
      throw this.mapError(e);
    }
  }

  estimateTokens(text: string): number {
    // Rough heuristic: ~4 chars per token. Adequate for budgeting; not exact.
    return Math.ceil(text.length / 4);
  }

  mapError(err: unknown): LMError {
    const e = err as { name?: string; message?: string; status?: number };
    const name = e.name ?? "";
    const msg = e.message ?? String(err);
    let cause: LMErrorCause = "unknown";
    let retryable = false;
    if (name.includes("ContextOverflow") || msg.includes("context length")) {
      cause = "context_overflow";
      retryable = false;
    } else if (name.includes("RateLimit") || e.status === 429) {
      cause = "rate_limit";
      retryable = true;
    } else if (name.includes("Authentication") || e.status === 401) {
      cause = "auth";
      retryable = false;
    } else if (name.includes("Network") || name.includes("Fetch")) {
      cause = "network";
      retryable = true;
    }
    return new LMError(cause, msg, retryable);
  }
}
