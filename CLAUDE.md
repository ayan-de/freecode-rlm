# CLAUDE.md

This file extends AGENTS.md with Claude Code-specific guidance.

See AGENTS.md for project-wide rules.

## Claude-specific

- For new features or behavior changes, start with the `brainstorming` skill.
- For plans, use the `writing-plans` skill (one plan per milestone).
- Prefer `test-driven-development` for any non-trivial function.
- Run `pnpm build && pnpm test` before claiming work complete.
- Use the `verification-before-completion` skill before any "done" claim.
