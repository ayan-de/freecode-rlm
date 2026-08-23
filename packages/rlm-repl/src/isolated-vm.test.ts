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

  it("hints at wrapping in an async IIFE when code uses bare top-level await", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("await Promise.resolve(1)");
    expect(r.success).toBe(false);
    expect(r.error?.name).toBe("SyntaxError");
    expect(r.error?.message).toContain("await is only valid");
    expect(r.error?.message).toContain("async IIFE");
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

  it("awaits a returned Promise so async IIFEs resolve to their value", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("(async () => { return await Promise.resolve(99); })()");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(99);
  });

  it("captures rejected Promise as success=false with the rejection reason", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute(
      "(async () => { throw new Error('async-boom'); })()",
    );
    expect(r.success).toBe(false);
    expect(r.error?.message).toBe("async-boom");
  });
});

// Paper §2: the REPL environment is persistent, and the model is expected to
// "build up intermediate values and the final response into new variables"
// across iterations (Algorithm 1: `(state, stdout) <- REPL(state, code)`).
// Appendix C.1's canonical strategy chunks the context, sub-queries each
// chunk, and accumulates answers into a buffer over several turns. All of
// that requires declarations to outlive a single execute() call.
// See VERIFICATION.md V-03.
describe("IsolatedVmREPL state persistence across execute() calls", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("keeps a `const` binding visible to the next execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("const buf = ['a'];");
    const r = await repl.execute("buf.length");
    expect(r.error).toBeUndefined();
    expect(r.expression).toBe(1);
  });

  it("keeps a `let` binding visible and reassignable in the next execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("let total = 3;");
    const r = await repl.execute("total = total * 2; total");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(6);
  });

  it("keeps a `var` binding visible to the next execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("var n = 7;");
    const r = await repl.execute("n + 1");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(8);
  });

  it("keeps a function declaration callable in the next execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("function head(s) { return s.slice(0, 2); }");
    const r = await repl.execute("head('hello')");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("he");
  });

  // The Appendix C.1 buffer pattern, in miniature: chunk, process, accumulate
  // over successive turns, then aggregate.
  it("accumulates into a buffer across several execute() calls", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("const buffers = [];");
    await repl.execute("buffers.push('chunk-0 summary');");
    await repl.execute("buffers.push('chunk-1 summary');");
    const r = await repl.execute("buffers.join(' | ')");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("chunk-0 summary | chunk-1 summary");
  });

  it("preserves earlier state when an execute() throws", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("const keep = 'safe';");
    const bad = await repl.execute("throw new Error('boom')");
    expect(bad.success).toBe(false);
    const r = await repl.execute("keep");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("safe");
  });

  it("still scopes stdout per call while sharing variables", async () => {
    repl = new IsolatedVmREPL();
    const first = await repl.execute("const label = 'x'; console.log('one');");
    const second = await repl.execute("console.log(label + '-two');");
    expect(first.stdout).toEqual(["one"]);
    expect(second.stdout).toEqual(["x-two"]);
    expect(repl.readStdout()).toEqual(["one", "x-two"]);
  });

  // Persistence has a JS-specific cost: a name declared with const/let in an
  // earlier turn cannot be re-declared in a later one. Surface it the same way
  // we surface the bare-top-level-await trap, so the model can recover.
  it("hints that a redeclared identifier is held over from an earlier turn", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("const buf = ['a'];");
    const r = await repl.execute("const buf = ['b'];");
    expect(r.success).toBe(false);
    expect(r.error?.name).toBe("SyntaxError");
    expect(r.error?.message).toContain("already been declared");
    expect(r.error?.message).toContain("earlier turn");
  });
});
