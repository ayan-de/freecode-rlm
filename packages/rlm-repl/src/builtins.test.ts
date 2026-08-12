import { describe, it, expect, afterEach } from "vitest";
import { installBuiltins, IsolatedVmREPL } from "./index.js";

describe("installBuiltins", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("exposes FINAL, FINAL_VAR, PRINT into the sandbox", async () => {
    repl = new IsolatedVmREPL();
    installBuiltins(repl);
    const r = await repl.execute("FINAL('hello')");
    expect(r.success).toBe(true);
    expect(r.expression).toEqual({ __final: "hello" });
  });

  it("PRINT writes to stdout via console.log", async () => {
    repl = new IsolatedVmREPL();
    installBuiltins(repl);
    const r = await repl.execute("PRINT('visible'); 'done'");
    expect(r.success).toBe(true);
    expect(r.stdout).toContain("visible");
    expect(r.expression).toBe("done");
  });

  it("FINAL_VAR returns a sentinel referencing the variable name", async () => {
    repl = new IsolatedVmREPL();
    installBuiltins(repl);
    await repl.load("answer", 42);
    const r = await repl.execute("FINAL_VAR('answer')");
    expect(r.success).toBe(true);
    expect(r.expression).toEqual({ __finalVar: "answer" });
  });

  it("records the call on __finalCall even when FINAL is a bare statement, not returned", async () => {
    // A braced async arrow function body does NOT implicitly return its
    // last expression's value, so `FINAL(x);` written as a plain statement
    // (rather than `return FINAL(x);`) leaves the IIFE's completion value
    // as undefined. finalCall is the side-channel that still catches it.
    repl = new IsolatedVmREPL();
    installBuiltins(repl);
    const r = await repl.execute("(async () => { FINAL('not returned'); })()");
    expect(r.success).toBe(true);
    expect(r.expression).toBeUndefined();
    expect(r.finalCall).toEqual({ __final: "not returned" });
  });

  it("resets __finalCall between execute() calls so a prior FINAL doesn't leak forward", async () => {
    repl = new IsolatedVmREPL();
    installBuiltins(repl);
    await repl.execute("FINAL('first')");
    const r = await repl.execute("1 + 1");
    expect(r.finalCall).toBeUndefined();
  });
});
