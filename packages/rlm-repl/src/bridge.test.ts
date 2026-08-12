import { describe, it, expect, afterEach } from "vitest";
import { installBridge, IsolatedVmREPL } from "./index.js";

describe("installBridge", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("exposes llm_query and rlm_query into the sandbox", async () => {
    repl = new IsolatedVmREPL();
    const calls: string[] = [];
    installBridge(repl, {
      llmQuery: async (prompt: string) => {
        calls.push(`llm:${prompt}`);
        return "L";
      },
      rlmQuery: async (prompt: string) => {
        calls.push(`rlm:${prompt}`);
        return "R";
      },
    });
    const r1 = await repl.execute("(async () => await llm_query('hi'))()");
    expect(r1.success).toBe(true);
    expect(r1.expression).toBe("L");
    const r2 = await repl.execute("(async () => await rlm_query('there'))()");
    expect(r2.success).toBe(true);
    expect(r2.expression).toBe("R");
    expect(calls).toEqual(["llm:hi", "rlm:there"]);
  });

  it("llm_query errors propagate into the sandbox", async () => {
    repl = new IsolatedVmREPL();
    installBridge(repl, {
      llmQuery: async () => {
        throw new Error("kaboom");
      },
      rlmQuery: async () => "",
    });
    const r = await repl.execute(
      "(async () => { try { await llm_query('x'); } catch (e) { return e.message; } })()",
    );
    expect(r.success).toBe(true);
    expect(r.expression).toBe("kaboom");
  });

  it("does not expose bash/readFile/writeFile when no system-tool callbacks are given", async () => {
    repl = new IsolatedVmREPL();
    installBridge(repl, {
      llmQuery: async () => "",
      rlmQuery: async () => "",
    });
    const r = await repl.execute("typeof bash");
    expect(r.expression).toBe("undefined");
  });

  it("exposes bash/readFile/writeFile when system-tool callbacks are given", async () => {
    repl = new IsolatedVmREPL();
    const calls: string[] = [];
    installBridge(repl, {
      llmQuery: async () => "",
      rlmQuery: async () => "",
      bash: async (cmd: string) => {
        calls.push(`bash:${cmd}`);
        return { stdout: "out", stderr: "", exitCode: 0 };
      },
      readFile: async (path: string) => {
        calls.push(`read:${path}`);
        return "contents";
      },
      writeFile: async (path: string, content: string) => {
        calls.push(`write:${path}:${content}`);
      },
    });
    const r1 = await repl.execute("(async () => await bash('echo hi'))()");
    expect(r1.expression).toEqual({ stdout: "out", stderr: "", exitCode: 0 });
    const r2 = await repl.execute("(async () => await readFile('/tmp/x'))()");
    expect(r2.expression).toBe("contents");
    const r3 = await repl.execute("(async () => await writeFile('/tmp/x', 'y'))()");
    expect(r3.success).toBe(true);
    expect(calls).toEqual(["bash:echo hi", "read:/tmp/x", "write:/tmp/x:y"]);
  });
});