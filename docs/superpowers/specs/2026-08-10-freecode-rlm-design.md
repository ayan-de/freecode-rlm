# freecode-rlm — Initial Design

**Date:** 2026-08-10
**Status:** Approved (brainstorming phase complete)
**Author:** FreeCode (brainstorming with ayan-de)

## 1. Goal and Philosophy

freecode-rlm is a **production-grade Recursive Language Model (RLM) implementation in TypeScript**. It exists as a learning project: we study three reference implementations — `rlm/`, `rlm-minimal/`, and `prime-agent/` (under `/home/ayan-de/Projects/githubProjects/agents/rlm/`) — and rebuild the RLM idea natively in TS rather than translating or wrapping the Python source.

The governing philosophy is **"if I cannot make it then I do not understand it."** Every component is reimplemented in this repo. No imports from `freecode/` (the earlier project) or from the RLM reference repos. Those are read for ideas, never for code.

freecode-rs replaces the canonical `llm.completion(prompt, model)` call with `rlm.completion(prompt, model)`. The prompt is offloaded as a variable in a JavaScript REPL that the LM writes code against, and the LM can launch sub-LM and sub-RLM calls as functions inside that REPL.

## 2. Reference Implementations

| Repo | What we learn from it |
|---|---|
| `rlm/` (full Python) | Canonical RLM design: REPL env, sub-calls as functions, prompt as object, depth-bounded recursion, trajectory metadata, sandbox isolation. The North Star. |
| `rlm-minimal/` | Stripped-down RLM: `rlm_repl.py` + `repl.py`. Two files, ~300 LOC. Direct mapping to our `rlm-core` + `rlm-repl`. The cleanest pedagogical source. |
| `prime-agent/` (TS) | TS-native agent runtime patterns: event-driven loop, tool execution modes, streaming, message transformation. We learn TS patterns here even though we reject its JSON tool-calling paradigm. |
| `freecode/` (sibling project) | Existing harness. Reference architecture only — agent loop, subagent, compaction, recovery. We reimplement, never import. |

## 3. Architecture Overview

Mirrors `rlm/`'s package shape in TypeScript. Three core packages + one CLI app + one docs app.

```
freecode-rlm/
├── apps/
│   ├── cli/                  # @freecode-rs/cli — entry point
│   └── web/                  # docs + learning site (Next.js; pre-existing)
├── packages/
│   ├── rlm-core/             # @freecode-rs/core — RLM class, types, loop, recursion budget
│   ├── rlm-client/           # @freecode-rs/client — LMClient interface + Vercel AI SDK adapter
│   ├── rlm-repl/             # @freecode-rs/repl — REPL interface + isolated-vm impl
│   └── (shared) eslint-config, typescript-config, ui (pre-existing)
├── docs/
│   └── superpowers/specs/    # design docs (this file)
├── AGENTS.md                 # agent-facing project rules
└── CLAUDE.md                 # Claude Code-specific rules
```

### Boundaries

- `rlm-core` knows nothing about isolated-vm or AI SDK. It consumes two interfaces: `REPL` and `LMClient`.
- `rlm-client` exports `VercelAIClient` implementing `LMClient` from `rlm-core`.
- `rlm-repl` exports `IsolatedVmREPL` implementing `REPL` from `rlm-core`.
- `apps/cli` wires them together. The default wiring is: `RLM(VercelAIClient, IsolatedVmREPL)`.

### Mapping to rlm (Python)

| rlm/ | freecode-rs |
|---|---|
| `rlm/rlm.py` (RLM class) | `packages/rlm-core/src/rlm.ts` |
| `rlm/repl.py` (REPL base + LocalREPL) | `packages/rlm-repl/src/{interface,isolated-vm}.ts` |
| `rlm/clients/openai.py` | `packages/rlm-client/src/{interface,vercel-ai}.ts` |
| `rlm/main.py` | `apps/cli/src/index.ts` |
| `rlm/utils/` | `packages/rlm-core/src/utils/` |
| `rlm/logger/` | `packages/rlm-core/src/logger.ts` |

## 4. REPL Interface and Sub-Call Bridge

The REPL is the heart of the system. The LLM writes JavaScript; we execute it in an isolated-vm sandbox; we expose `llm_query` and `rlm_query` as functions inside that sandbox.

### 4.1 REPL Interface (`packages/rlm-repl/src/interface.ts`)

```ts
export interface REPL {
  // Load a variable into the REPL scope (e.g. `context = "very long prompt..."`).
  load(name: string, value: unknown): Promise<void>;

  // Execute a JS code chunk. Returns the final expression's value plus any stdout.
  execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult>;

  // Read all messages printed to stdout, in order.
  readStdout(): string[];

  // Get the variables currently in scope, with their values (used to build prompts).
  inspect(): Promise<Record<string, unknown>>;

  // Tear down the underlying isolated-vm context.
  dispose(): Promise<void>;
}

export interface REPLResult {
  success: boolean;
  stdout: string[];             // console.log/console.error output during this call
  expression?: unknown;         // value of the final expression (rlm convention)
  error?: { name: string; message: string; trace: string };
  durationMs: number;
}
```

### 4.2 Sub-Call Bridge (host → sandbox → host)

When user code calls `llm_query("...")`, we must call out to the LM from inside the REPL, await the result, and return it into the sandbox without deadlocking or breaking isolation.

**Mechanism:** isolated-vm supports synchronous and asynchronous host-callable callbacks via `ivm.Reference` and `Script.run`. We expose the following into the sandbox scope as `ivm.Reference`s:

- `llm_query(prompt: string): Promise<string>` — calls `LMClient.chat()` and returns the assistant text.
- `rlm_query(prompt: string): Promise<string>` — spawns a child `RLM` (its own REPL) and returns its final answer string. Depth-tracked.
- `PRINT(x)` — appends `String(x)` to `stdout`, returns nothing.
- `FINAL(answer: string)` / `FINAL_VAR(name: string)` — set a sentinel on the host side, returned via `REPLResult.expression`.

The sandbox-side wrappers are small JS shims that `apply` the host `Reference` and unwrap the result.

### 4.3 Defaults and Limits

| Setting | Default | Configurable per-REPL |
|---|---|---|
| `execute.timeoutMs` | 30,000 ms | yes |
| isolated-vm `memoryLimit` | 256 MB | yes |
| `maxStdoutLength` (rolling buffer) | 100 KB | yes |
| Code chunk max length | 64 KB | yes |

On timeout or memory breach, `execute()` returns `{ success: false, error: ... }` with the partial stdout the REPL captured before failure. The loop surfaces the error to the LM as a regular `REPLResult` and continues iterating.

## 5. RLM Core / Completion Loop

The `RLM` class is the public API. It owns: a `REPL`, an `LMClient`, the system prompt, recursion budget, and the iteration loop.

### 5.1 Public API (`packages/rlm-core/src/rlm.ts`)

```ts
const rlm = new RLM({
  client: new VercelAIClient({ model: "gpt-5-nano" }),
  repl: new IsolatedVmREPL({ timeoutMs: 30_000, memoryMb: 256 }),
  systemPrompt: BUILTIN_SYSTEM_PROMPT,
  maxDepth: 3,
  maxIterations: 50,
  maxSubCalls: 100,
  verbose: false,
});

const result = await rlm.completion("Print the first 100 powers of two.");
// result.response       — final string answer
// result.iterations     — each model turn + REPL result (for logging/UI)
// result.metadata       — full trajectory (matches rlm's metadata field)
```

### 5.2 The Loop

```
1. Load user prompt as the REPL variable `context`.
2. Initialize REPL scope with: `llm_query`, `rlm_query`, `PRINT`, `FINAL`,
   `FINAL_VAR`, `context`, and helper docs as comments.
3. Loop up to `maxIterations` times:
   a. Build messages = [system prompt, *history of code/result pairs*].
   b. Call `client.chat(messages)` — get the assistant turn.
   c. Extract code blocks from the assistant turn (markdown fence ```repl ... ```).
   d. Append the assistant turn to history.
   e. `REPL.execute(code)` → result.
   f. Append the result to history.
   g. If `result.expression` is a FINAL/FINAL_VAR sentinel, break and return.
4. If `maxIterations` reached without FINAL, return the last assistant text plus a warning.
```

### 5.3 System Prompt (defaults)

The built-in system prompt tells the LLM:

- It has a JavaScript REPL it can write code against.
- It can call `llm_query(prompt)` for one-shot sub-LM calls (returns a string).
- It can call `rlm_query(prompt)` for full sub-RLM (its own REPL, up to `maxDepth - currentDepth`).
- `PRINT(x)` prints to its view of stdout.
- `context` is the user's prompt (may be very large — chunk it, don't read it directly).
- Use ```` ```repl ` fenced code blocks; only the LAST block per turn runs.
- Call `FINAL("answer")` (or `FINAL_VAR(name)`) when ready to answer.
- Its goal is to *answer the user* by inspecting context programmatically.

The prompt ships as a constant in `rlm-core` so users can read/override it.

### 5.4 Recursion Depth

Each `RLM` instance carries `currentDepth` (default 0). When user code inside the REPL calls `rlm_query`:

- If `currentDepth + 1 < maxDepth`: spawn a child `RLM` with `currentDepth + 1`, its own `IsolatedVmREPL`, sharing the `LMClient`. The child runs to completion; its `response` is returned to the parent's REPL.
- If `currentDepth + 1 >= maxDepth`: silently degrade — the `rlm_query` bridge behaves like `llm_query` (one-shot LM call, no inner REPL). We do **not** raise an error in the sandbox. A debug-mode flag (`verbose: true`) emits a one-line notice on the host. The hard cap on sub-calls (`maxSubCalls`) applies across the whole run, including children.

`maxSubCalls` is shared across all depths of one root `completion()` call to prevent runaway cost from recursion.

### 5.5 Final Answer Extraction

Two supported patterns (matching rlm):

- **Literal:** `FINAL("the answer is 42")` — the string is the final answer.
- **By variable:** `FINAL_VAR("result")` — the variable named `result` in the REPL scope is the final answer (stringified).

`FINAL`/`FINAL_VAR` are not real functions in the sandbox. They are sentinel markers the host recognizes in `REPLResult.expression`. The host evaluates `FINAL_VAR` by looking up the variable via `REPL.inspect()`.

## 6. LM Client Interface

### 6.1 Interface (`packages/rlm-client/src/interface.ts`)

```ts
export interface LMClient {
  // Single-turn chat completion. Returns the assistant message.
  chat(messages: ChatMessage[]): Promise<ChatMessage>;

  // Streaming variant — yields deltas + a final message.
  stream(messages: ChatMessage[]): AsyncIterable<ChatDelta | ChatFinal>;

  // Optional token count estimate (used for budget enforcement).
  estimateTokens?(text: string): number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatDelta = { kind: "delta"; text: string };
export type ChatFinal = { kind: "final"; message: ChatMessage };

export class LMError extends Error {
  constructor(
    public cause:
      | "rate_limit"
      | "auth"
      | "network"
      | "context_overflow"
      | "unknown",
    message: string,
    public retryable: boolean
  ) {
    super(message);
  }
}
```

### 6.2 Vercel AI SDK Adapter (`packages/rlm-client/src/vercel-ai.ts`)

Thin wrapper:

- `chat()` → `generateText({ model, messages })`.
- `stream()` → `streamText({ model, messages })`, yields deltas.
- Converts `AIError` → `LMError` (maps context-overflow and rate-limit causes; surfaces auth/network as their respective causes).
- API key resolution: env var first, optional `getApiKey` callback (matches freecode's pattern for expiring OAuth tokens).

## 7. Configuration and Defaults

| Setting | Default | Notes |
|---|---|---|
| `model` (VercelAIClient) | `gpt-5-nano` | User-supplied at construction time. |
| `repl.timeoutMs` | 30,000 ms | Per `execute()` call. |
| `repl.memoryMb` | 256 MB | isolated-vm memory limit. |
| `rlm.maxDepth` | 3 | Includes the root. So at depth 3, child sub-RLMs only do `llm_query`. |
| `rlm.maxIterations` | 50 | Outer loop iterations per `completion()`. |
| `rlm.maxSubCalls` | 100 | Total across all depths of one `completion()` call. |
| `rlm.verbose` | false | Rich console output (mirrors rlm's verbose flag). |

All settings are passed at `new RLM({...})` construction time. No runtime mutation API.

## 8. Iteration Plan (Milestones)

Each milestone is a self-contained, testable slice. One PR per milestone.

### M0 — Bootstrap

- Monorepo packages initialized, names match Section 3.
- vitest configured in each package; one passing smoke test per package.
- `@freecode-rs/cli` prints `ready` and exits.
- AGENTS.md and CLAUDE.md exist and match Section 9.

**Verify:** `pnpm build && pnpm test` passes; `pnpm -F @freecode-rs/cli dev` prints `ready`.

### M1 — REPL (isolated-vm)

- `REPL` interface.
- `IsolatedVmREPL`: load/execute/readStdout/inspect/dispose.
- Console bridging (`console.log` → stdout buffer).
- Timeout + memory limit enforcement.
- Tests: arbitrary JS executes, expression values return, timeouts trigger, memory breach returns error.

**Verify:** All `rlm-repl` tests green; no host globals leak into sandbox; errors captured with traces.

### M2 — LM Client (AI SDK)

- `LMClient` interface + `LMError`.
- `VercelAIClient` with `chat()` + `stream()`.
- Tests: mock client (no API key needed); one integration test against `gpt-5-nano`.

**Verify:** `rlm-client` tests green; integration test reaches the API and returns a string.

### M3 — RLM depth=0

- `RLM` class with the loop from Section 5.2, no sub-calls wired yet.
- Built-in system prompt.
- FINAL/FINAL_VAR extraction.
- Tests: end-to-end with a real model on "print first 100 powers of two" (matches rlm-minimal's main.py quickstart).

**Verify:** E2E test produces correct output; trajectory metadata captures all iterations.

### M4 — Sub-calls and recursion

- `llm_query` and `rlm_query` host-bridge into the sandbox.
- Depth tracking and budget enforcement.
- Tests: needle-in-haystack (NIAH) — embed a random number in ~1M lines of random text; the model finds it. This is rlm-minimal's signature test.

**Verify:** NIAH test passes against a large context; recursion budget enforced (test where `maxDepth=1` rejects sub-RLM).

### M5 — Polish

- Rich console logging (verbose mode) with iteration markers.
- CLI flags: `--model`, `--verbose`, `--max-depth`, `--max-iterations`, `--max-sub-calls`, `--repl-timeout-ms`, `--repl-memory-mb`.
- README + examples in `apps/web`.
- Trajectory JSON dump (matches rlm's `metadata` field).

**Verify:** `freecode-rlm "Print first 100 powers of two" --verbose` prints nicely; docs site renders.

## 9. AGENTS.md and CLAUDE.md

Both files share a common core. CLAUDE.md adds Claude Code-specific guidance.

### 9.1 AGENTS.md (draft)

```markdown
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
- One PR per milestone (M0..M5). Don't bundle.
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
```

### 9.2 CLAUDE.md

AGENTS.md contents, plus:

```markdown
## Claude-specific

- For new features or behavior changes, start with the `brainstorming` skill.
- For plans, use the `writing-plans` skill (one plan per milestone).
- Prefer `test-driven-development` for any non-trivial function.
- Run `pnpm build && pnpm test` before claiming work complete.
```

## 10. Out of Scope (v1)

These are explicitly **not** part of v1:

- Sandboxes other than isolated-vm (no Docker, Modal, E2B, Daytona in v1).
- Compaction / context summarization (rlm has it; defer until we have a need).
- Persistent multi-turn sessions (`context_N` / `history_N` versioning in rlm).
- Visualizer / trajectory UI (the Next.js app stays a docs site in v1).
- Training environment / RL fine-tuning of RLMs.
- MCP server integrations.
- Telemetry / cost dashboards.

These can be revisited in v2 once the core loop is solid.

## 11. Open Questions / Risks

- **isolated-vm + async host calls**: confirmed working in isolated-vm v5.x, but the API for async callbacks has historically had sharp edges. We allocate time in M1 to validate the bridge shape.
- **Vercel AI SDK prompt shape**: AI SDK uses its own message types with parts. We'll wrap to/from our `ChatMessage` shape so core never imports AI SDK types.
- **Cost discipline**: recursion + verbose sub-calls can blow up token spend. `maxSubCalls` is the primary guardrail; we surface it in CLI warnings before run.
- **System prompt drift**: the default system prompt is a key piece of "personality." We'll write tests that assert the prompt contains certain phrases and guidance, so changes are intentional.

## 12. Success Criteria

v1 is "done" when all of the following hold:

1. `freecode-rlm "Print the first 100 powers of two"` prints the correct list and exits 0.
2. The needle-in-haystack test passes (find a random number in a 1M-token context).
3. Sub-RLM recursion works at depth=2 and is correctly throttled at `maxDepth`.
4. CI runs `pnpm build && pnpm test` green on a fresh checkout.
5. AGENTS.md and CLAUDE.md exist and are accurate.
6. The architecture in Section 3 is in place; no package is empty.
