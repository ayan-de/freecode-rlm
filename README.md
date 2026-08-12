# freecode-rlm

A Recursive Language Model (RLM) runtime in TypeScript.

The LLM writes JavaScript inside a sandboxed REPL; it can inspect a large
context programmatically and call sub-LM or sub-RLM functions.

## References

- Paper: [Recursive Language Models](https://arxiv.org/abs/2512.24601) (Zhang, Kraska, Khattab)
- Author write-up: https://alexzhang13.github.io/blog/2025/rlm/
- Official implementation: https://github.com/alexzhang13/rlm

## Quickstart

```bash
pnpm install
pnpm build
export MINIMAX_API_KEY=sk-...
pnpm -F @freecode-rs/cli dev -- "Print the first 100 powers of two"
```

Default model is `MiniMax-M3` against the OpenAI-compatible endpoint at
`https://api.minimax.io/v1`. Pass `--model`, `--base-url`, and `--api-key`
to override.

## Layout

- `packages/rlm-core` — RLM class, types, loop, recursion depth + budget
- `packages/rlm-client` — LM provider adapters (Vercel AI SDK)
- `packages/rlm-repl` — sandbox REPL (isolated-vm) + host bridge
- `apps/cli` — command-line entry (`freecode-rlm <prompt> [...]`)
- `apps/web` — Next.js landing page

See `docs/superpowers/specs/2026-08-10-freecode-rlm-design.md` for the design.

## Tests

```bash
pnpm test                # unit tests (live API tests are skipped without MINIMAX_API_KEY)
pnpm -r build            # strict tsc across all packages and apps
```

Live coverage:

- `packages/rlm-client` — MiniMax-M3 chat round-trip
- `packages/rlm-core` — end-to-end: print the first 100 powers of two;
  needle-in-the-haystack (50k-line lorem, find a secret token)

## Learning project

We study and re-implement (no copy/paste from, no imports of) the following
references:

- `/home/ayan-de/Projects/githubProjects/agents/rlm/rlm` (full Python impl)
- `/home/ayan-de/Projects/githubProjects/agents/rlm/rlm-minimal` (minimal impl)
- `/home/ayan-de/Projects/githubProjects/agents/rlm/prime-agent` (TS agent runtime)
- `/home/ayan-de/Projects/freecode` (sibling harness project)
