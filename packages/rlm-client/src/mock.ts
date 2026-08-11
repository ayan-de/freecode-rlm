import type { ChatEvent, ChatMessage, LMClient } from "./types.js";

export class MockLMClient implements LMClient {
  readonly calls: ChatMessage[][] = [];
  private responses: ChatMessage[];
  private idx = 0;

  constructor(responses: ChatMessage[]) {
    this.responses = responses;
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    this.calls.push(messages);
    const resp = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx++;
    return resp;
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatEvent> {
    const final = await this.chat(messages);
    yield { kind: "delta", text: final.content };
    yield { kind: "final", message: final };
  }
}
