# freecode-rlm

Production-grade Recursive Language Model (RLM) implementation in TypeScript.
Learning project — we read rlm/, rlm-minimal/, and prime-agent/ (under
/home/ayan-de/Projects/githubProjects/agents/rlm/) before designing new pieces.

## Stack

- pnpm workspaces + Turborepo
- TypeScript 5.9 (strict mode)
- vitest for tests
- isolated-vm for sandbox
- Vercel AI SDK for LM providers

## Rules

- "If I cannot make it then I do not understand it." Reimplement, never import from
  rlm/rlm-minimal/prime-agent or from freecode/.
- TDD preferred. Every public function has a test.
- YAGNI. No features without a stated user need.
- Match surrounding style. Don't refactor unrelated code.
- One commit per task. Don't bundle.
- Never commit secrets. Use .env (already gitignored).

## Common commands

- pnpm build         # turbo build all
- pnpm test          # vitest in all packages
- pnpm lint          # eslint
- pnpm -F @freecode-rs/cli dev      # run the CLI locally
- pnpm -F @freecode-rs/cli build    # build the CLI

## Where to read

Before designing anything new, read the matching reference:
- rlm/rlm.py             → packages/rlm-core/src/rlm.ts
- rlm/repl.py            → packages/rlm-repl/src/isolated-vm.ts
- rlm/clients/openai.py  → packages/rlm-client/src/vercel-ai.ts
- rlm-minimal/main.py    → apps/cli/src/index.ts
- prime-agent/packages/agent/src/agent-loop.ts → TS-native loop patterns