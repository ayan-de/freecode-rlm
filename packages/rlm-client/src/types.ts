export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatDelta = { kind: "delta"; text: string };
export type ChatFinal = { kind: "final"; message: ChatMessage };
export type ChatEvent = ChatDelta | ChatFinal;

export interface LMClient {
  chat(messages: ChatMessage[]): Promise<ChatMessage>;
  stream(messages: ChatMessage[]): AsyncIterable<ChatEvent>;
  estimateTokens?(text: string): number;
}

export type LMErrorCause =
  | "rate_limit"
  | "auth"
  | "network"
  | "context_overflow"
  | "unknown";

export class LMError extends Error {
  readonly cause: LMErrorCause;
  readonly retryable: boolean;
  constructor(cause: LMErrorCause, message: string, retryable: boolean) {
    super(message);
    this.name = "LMError";
    this.cause = cause;
    this.retryable = retryable;
  }
}
