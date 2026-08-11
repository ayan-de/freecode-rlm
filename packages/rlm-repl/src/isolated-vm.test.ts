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

  it("load() makes a variable visible to subsequent execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.load("x", 42);
    const r = await repl.execute("x * 2");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(84);
  });

  it("inspect() returns currently bound variables", async () => {
    repl = new IsolatedVmREPL();
    await repl.load("a", 1);
    await repl.load("b", "hi");
    const vars = await repl.inspect();
    expect(vars.a).toBe(1);
    expect(vars.b).toBe("hi");
  });

  it("readStdout() reflects cumulative console output across execute() calls", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("console.log('one')");
    await repl.execute("console.log('two')");
    expect(repl.readStdout()).toEqual(["one", "two"]);
  });

  it("enforces timeoutMs and returns success=false", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("while (true) {}", { timeoutMs: 100 });
    expect(r.success).toBe(false);
    // isolated-vm throws "Script execution timed out." on timeout.
    expect(r.error?.message).toMatch(/timeout|timed|terminated/i);
  });
});
