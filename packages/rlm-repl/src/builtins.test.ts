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
});
