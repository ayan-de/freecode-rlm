import { describe, it, expect } from "vitest";
import { wrapSkillModule } from "./wrap.js";
import type { Skill } from "./types.js";

describe("wrapSkillModule", () => {
  it("returns a WrappedSkill with name, description, and bindCode", () => {
    const skill: Skill = {
      name: "websearch",
      description: "Search Google via Serper.",
      run: async () => "ok",
    };
    const wrapped = wrapSkillModule(skill);
    expect(wrapped.name).toBe("websearch");
    expect(wrapped.description).toBe("Search Google via Serper.");
    expect(wrapped.bindCode).toContain('globalThis["websearch"]');
  });

  it("bindCode references an ivm.Reference named __skill_<name>_ref", () => {
    const skill: Skill = {
      name: "websearch",
      description: "x",
      run: async () => "",
    };
    const wrapped = wrapSkillModule(skill);
    expect(wrapped.bindCode).toContain("__skill_websearch_ref");
    expect(wrapped.bindCode).toContain("apply(");
    expect(wrapped.bindCode).toContain("copy: true");
    expect(wrapped.bindCode).toContain("promise: true");
  });

  it("rejects non-identifier names", () => {
    expect(() => wrapSkillModule({ name: "web search", description: "", run: async () => "" })).toThrow(
      /Invalid skill name/,
    );
    expect(() => wrapSkillModule({ name: "123", description: "", run: async () => "" })).toThrow(
      /Invalid skill name/,
    );
  });

  it("escapes the description into a JSON string literal", () => {
    const skill: Skill = {
      name: "websearch",
      description: 'has "quotes" and \n newlines',
      run: async () => "",
    };
    const wrapped = wrapSkillModule(skill);
    expect(wrapped.bindCode).toContain('has \\"quotes\\"');
    expect(wrapped.bindCode).toContain("\\n newlines");
  });
});
