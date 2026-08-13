import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Skill } from "./types.js";

/**
 * Scan `skillsDir` for subdirectories that are pnpm workspace packages
 * declaring `"freecodeSkill": true` in their package.json. For each,
 * resolve the ESM entry (preferring `module`, falling back to `main`)
 * and dynamic-import it. Validate the exported module has the Skill
 * shape and return the array.
 *
 * Failures are surfaced: an unreadable package.json, a missing entry,
 * or a malformed skill throws. The caller decides whether to fail
 * the whole RLM run or log + continue.
 */
export async function loadSkills(skillsDir: string): Promise<Skill[]> {
  const absDir = resolve(skillsDir);
  const entries = await readdir(absDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const skills: Skill[] = [];
  for (const dir of dirs) {
    const pkgPath = join(absDir, dir, "package.json");
    let pkg: { freecodeSkill?: boolean; module?: string; main?: string; name?: string };
    try {
      const raw = await readFile(pkgPath, "utf8");
      pkg = JSON.parse(raw);
    } catch (e) {
      // No package.json — silently skip (not a skill package).
      continue;
    }
    if (pkg.freecodeSkill !== true) continue;

    const entry = pkg.module ?? pkg.main;
    if (!entry) {
      throw new Error(`Skill package ${dir} has no "module" or "main" entry in package.json`);
    }
    const entryAbs = join(absDir, dir, entry);
    const mod = (await import(pathToFileURL(entryAbs).href)) as {
      default?: Partial<Skill>;
    } & Partial<Skill>;
    const skill = mod.default ?? mod;
    if (typeof skill.run !== "function") {
      throw new Error(`Skill ${dir} does not export a "run" function`);
    }
    if (typeof skill.name !== "string" || !skill.name) {
      throw new Error(`Skill ${dir} does not export a string "name"`);
    }
    if (typeof skill.description !== "string") {
      throw new Error(`Skill ${dir} does not export a string "description"`);
    }
    skills.push({
      name: skill.name,
      description: skill.description,
      run: skill.run as Skill["run"],
    });
  }
  return skills;
}