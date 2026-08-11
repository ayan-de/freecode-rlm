import { describe, it, expect } from "vitest";
import { MockLMClient } from "./mock.js";

describe("MockLMClient", () => {
  it("returns the next configured response and advances the queue", async () => {
    const mock = new MockLMClient([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    expect((await mock.chat([])).content).toBe("first");
    expect((await mock.chat([])).content).toBe("second");
  });

  it("cycles the last response when queue is exhausted", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "only" }]);
    await mock.chat([]);
    expect((await mock.chat([])).content).toBe("only");
  });

  it("stream() yields a delta then a final event", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "hi" }]);
    const events = [];
    for await (const e of mock.stream([])) events.push(e);
    expect(events[0]).toEqual({ kind: "delta", text: "hi" });
    expect(events[1]).toEqual({ kind: "final", message: { role: "assistant", content: "hi" } });
  });

  it("records every chat() call for assertions", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "x" }]);
    await mock.chat([{ role: "user", content: "a" }]);
    await mock.chat([{ role: "user", content: "b" }]);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.[0]?.content).toBe("a");
  });
});
