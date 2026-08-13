import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSkills } from "./loader.js";

let tmp: string;
afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function makeSkillPackage(
  dir: string,
  name: string,
  pkg: Record<string, unknown>,
  exports: string,
): Promise<void> {
  const pkgDir = join(dir, name);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(join(pkgDir, "package.json"), JSON.stringify(pkg));
  await writeFile(join(pkgDir, "index.mjs"), exports);
}

describe("loadSkills", () => {
  it("loads every subdirectory that declares freecodeSkill: true", async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-"));
    await makeSkillPackage(
      tmp,
      "echo",
      { name: "echo-skill", freecodeSkill: true, module: "./index.mjs", type: "module" },
      `export const name = "echo"; export const description = "Echoes."; export async function run(x) { return \`got: \${x}\`; }`,
    );
    await makeSkillPackage(
      tmp,
      "noop",
      { name: "noop-skill", freecodeSkill: true, module: "./index.mjs", type: "module" },
      `export const name = "noop"; export const description = "No-op."; export async function run() { return ""; }`,
    );
    const skills = await loadSkills(tmp);
    expect(skills.map((s) => s.name)).toEqual(["echo", "noop"]);
    expect(skills.map((s) => s.description)).toEqual(["Echoes.", "No-op."]);
  });

  it("skips subdirectories without package.json", async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-"));
    await mkdir(join(tmp, "stranger"), { recursive: true });
    await makeSkillPackage(
      tmp,
      "echo",
      { name: "echo-skill", freecodeSkill: true, module: "./index.mjs", type: "module" },
      `export const name = "echo"; export const description = "Echoes."; export async function run() { return ""; }`,
    );
    const skills = await loadSkills(tmp);
    expect(skills.map((s) => s.name)).toEqual(["echo"]);
  });

  it("skips subdirectories without freecodeSkill: true", async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-"));
    await makeSkillPackage(
      tmp,
      "normal-pkg",
      { name: "normal-pkg", module: "./index.mjs", type: "module" },
      `export default {};`,
    );
    const skills = await loadSkills(tmp);
    expect(skills).toEqual([]);
  });

  it("throws when a skill-packed module is missing run()", async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-"));
    await makeSkillPackage(
      tmp,
      "broken",
      { name: "broken-skill", freecodeSkill: true, module: "./index.mjs", type: "module" },
      `export const name = "broken"; export const description = "broken";`,
    );
    await expect(loadSkills(tmp)).rejects.toThrow(/does not export a "run" function/);
  });

  it("falls back to main when module is missing", async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-"));
    const pkgDir = join(tmp, "mainonly");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "mainonly", freecodeSkill: true, main: "./index.cjs", type: "commonjs" }),
    );
    await writeFile(
      join(pkgDir, "index.cjs"),
      `module.exports = { name: "mainonly", description: "main", run: async () => "cjs" };`,
    );
    const skills = await loadSkills(tmp);
    expect(skills[0]?.name).toBe("mainonly");
  });
});