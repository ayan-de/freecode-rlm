import { describe, it, expect, afterEach } from "vitest";
import { installSkills } from "./install.js";
import { IsolatedVmREPL } from "../isolated-vm.js";
import type { Skill } from "./types.js";

describe("installSkills", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("binds a skill as a sandbox global with a callable .run()", async () => {
    repl = new IsolatedVmREPL();
    const skill: Skill = {
      name: "echo",
      description: "Echoes its argument.",
      run: async (x: unknown) => `got: ${String(x)}`,
    };
    installSkills(repl, [skill]);
    const r = await repl.execute(`(async () => echo.run("hi"))()`);
    expect(r.success).toBe(true);
    expect(r.expression).toBe("got: hi");
  });

  it("exposes __skillMeta as the list of installed skills", async () => {
    repl = new IsolatedVmREPL();
    const skills: Skill[] = [
      { name: "echo", description: "Echoes.", run: async () => "" },
      { name: "noop", description: "Does nothing.", run: async () => "" },
    ];
    installSkills(repl, skills);
    const r = await repl.execute(`__skillMeta.map((s) => s.name)`);
    expect(r.success).toBe(true);
    expect(r.expression).toEqual(["echo", "noop"]);
  });

  it("propagates errors from the host through to the sandbox as rejections", async () => {
    repl = new IsolatedVmREPL();
    const skill: Skill = {
      name: "boom",
      description: "Always throws.",
      run: async () => {
        throw new Error("kaboom");
      },
    };
    installSkills(repl, [skill]);
    const r = await repl.execute(`(async () => { try { await boom.run(); return "no error"; } catch (e) { return e.message; } })()`);
    expect(r.success).toBe(true);
    expect(r.expression).toBe("kaboom");
  });

  it("supports multiple skills and overwrites prior bindings on re-install", async () => {
    repl = new IsolatedVmREPL();
    installSkills(repl, [{ name: "echo", description: "v1", run: async () => "v1" }]);
    installSkills(repl, [{ name: "echo", description: "v2", run: async () => "v2" }]);
    const r = await repl.execute(`(async () => echo.run())()`);
    expect(r.success).toBe(true);
    expect(r.expression).toBe("v2");
  });
});