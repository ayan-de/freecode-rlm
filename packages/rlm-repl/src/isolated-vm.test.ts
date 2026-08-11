import { describe, it, expect, afterEach } from "vitest";
import { IsolatedVmREPL } from "./isolated-vm.js";

describe("IsolatedVmREPL.execute", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("returns success and expression for simple code", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("1 + 2");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(3);
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.stdout)).toBe(true);
  });

  it("captures console.log into stdout", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("console.log('hello'); 7");
    expect(r.success).toBe(true);
    expect(r.stdout).toContain("hello");
    expect(r.expression).toBe(7);
  });

  it("returns success=false on thrown error", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("throw new Error('boom')");
    expect(r.success).toBe(false);
    expect(r.error?.name).toBe("Error");
    expect(r.error?.message).toBe("boom");
  });

  it("isolates from host: process is undefined in sandbox", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("typeof process");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("undefined");
  });

  it("does not leak host console into sandbox", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("typeof globalThis.console");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("object"); // sandbox-side console only
  });
});
