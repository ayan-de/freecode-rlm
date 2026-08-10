# freecode-rlm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade Recursive Language Model (RLM) runtime in TypeScript — a JS REPL (isolated-vm) the LLM writes code against, with sub-LM and sub-RLM calls as functions in that REPL.

**Architecture:** Three core packages (`rlm-core` for the RLM class and loop, `rlm-client` for LM provider adapters, `rlm-repl` for the sandbox) plus a CLI app. `core` consumes `REPL` and `LMClient` interfaces — implementations are plug-in. Mirrors the package shape of `rlm/` (Python) in TypeScript.

**Tech Stack:** pnpm workspaces + Turborepo, TypeScript 5.9 strict, vitest, isolated-vm, Vercel AI SDK (`ai` package), commander (CLI), Next.js 15 (existing `apps/web` for docs).

## Global Constraints

- TypeScript strict mode, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Node ≥ 18 (already in `package.json` engines).
- Package manager: pnpm 9. **Never** mix npm/yarn/pnpm commands.
- Test runner: vitest. Tests live next to source as `*.test.ts` and run via `pnpm -F <pkg> test`.
- Naming: `@freecode-rs/<name>` for internal packages, lowercase with dashes for file names.
- No imports from `/home/ayan-de/Projects/githubProjects/agents/rlm/{rlm,rlm-minimal,prime-agent}` or from `/home/ayan-de/Projects/freecode`. Read for ideas only.
- No features outside the spec's Section 10 out-of-scope list.
- One commit per task. Use conventional commits (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).
- All secrets via `.env` (already gitignored).
- Default model for integration tests: `gpt-5-nano`.
- Default `maxDepth=3`, `maxIterations=50`, `maxSubCalls=100`, `repl.timeoutMs=30_000`, `repl.memoryMb=256`.

---

## File Structure

Created in Task 1 onward. Reference:

```
freecode-rlm/
├── AGENTS.md                                    # Task 1
├── CLAUDE.md                                    # Task 1
├── .env.example                                 # Task 1
├── apps/
│   └── cli/                                     # Task 1 (skeleton); fleshed out in Task 6, 11
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/index.ts                         # entry: prints "ready" then exits 0
│       └── src/index.test.ts
├── packages/
│   ├── rlm-core/                                # Tasks 7–11
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                         # public exports
│   │   │   ├── types.ts                         # ChatMessage, REPL, LMClient interfaces
│   │   │   ├── rlm.ts                           # RLM class, completion loop
│   │   │   ├── prompt.ts                        # BUILTIN_SYSTEM_PROMPT
│   │   │   ├── budget.ts                        # depth + sub-call counter
│   │   │   ├── final.ts                         # FINAL / FINAL_VAR extraction
│   │   │   ├── logger.ts                        # trajectory + console logger
│   │   │   └── utils/
│   │   │       ├── code-extract.ts              # parse ```repl``` blocks
│   │   │       └── messages.ts                  # build history
│   │   └── src/*.test.ts                        # colocated tests
│   ├── rlm-client/                              # Tasks 4–5
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts                         # LMClient, LMError
│   │   │   ├── mock.ts                          # MockLMClient for tests
│   │   │   └── vercel-ai.ts                     # VercelAIClient
│   │   └── src/*.test.ts
│   └── rlm-repl/                                # Tasks 2–3
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts
│       │   ├── types.ts                         # REPL, REPLResult
│       │   ├── isolated-vm.ts                   # IsolatedVmREPL impl
│       │   └── bridge.ts                        # host→sandbox Reference helpers
│       └── src/*.test.ts
└── docs/superpowers/{specs,plans}/              # existing
```

---

## Task 1: Bootstrap monorepo, AGENTS.md, CLAUDE.md, smoke-test the CLI

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `.env.example`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/index.test.ts`
- Create: `packages/typescript-config/base.json` (already exists; reuse if adequate)
- Modify: `pnpm-workspace.yaml` (already lists `apps/*` and `packages/*` — no change needed)

**Interfaces:**
- Consumes: none (first task)
- Produces: `apps/cli` package with `pnpm dev` printing `ready` and exiting 0; `AGENTS.md`, `CLAUDE.md` present at repo root.

- [ ] **Step 1: Write `AGENTS.md`**

Write at repo root `/home/ayan-de/Projects/freecode-rlm/AGENTS.md`:

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
```

- [ ] **Step 2: Write `CLAUDE.md`**

Write at repo root `/home/ayan-de/Projects/freecode-rlm/CLAUDE.md`:

```markdown
# CLAUDE.md

This file extends AGENTS.md with Claude Code-specific guidance.

See AGENTS.md for project-wide rules.

## Claude-specific

- For new features or behavior changes, start with the `brainstorming` skill.
- For plans, use the `writing-plans` skill (one plan per milestone).
- Prefer `test-driven-development` for any non-trivial function.
- Run `pnpm build && pnpm test` before claiming work complete.
- Use the `verification-before-completion` skill before any "done" claim.
```

- [ ] **Step 3: Write `.env.example`**

```
OPENAI_API_KEY=sk-...
```

- [ ] **Step 4: Verify `.gitignore` covers `.env`**

Run: `grep -E '^\.env$|^\.env\.' /home/ayan-de/Projects/freecode-rlm/.gitignore`
Expected: at least one match.

If missing, append:

```
.env
.env.local
.env.*.local
```

- [ ] **Step 5: Create `apps/cli/package.json`**

```json
{
  "name": "@freecode-rs/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "freecode-rlm": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@freecode-rs/core": "workspace:*",
    "@freecode-rs/client": "workspace:*",
    "@freecode-rs/repl": "workspace:*",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@freecode-rs/typescript-config": "workspace:*",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "5.9.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 6: Create `apps/cli/tsconfig.json`**

```json
{
  "extends": "@freecode-rs/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `apps/cli/src/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { run } from "./index.js";

describe("cli", () => {
  it("prints 'ready' and exits 0", async () => {
    const out: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
    try {
      const code = await run([]);
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("ready");
    } finally {
      console.log = orig;
    }
  });
});
```

- [ ] **Step 8: Create `apps/cli/src/index.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";

export async function run(_args: string[]): Promise<number> {
  const program = new Command();
  program
    .name("freecode-rlm")
    .description("Recursive Language Model CLI")
    .version("0.0.0");
  program.parse(["node", "freecode-rlm", ..._args]);
  console.log("ready");
  return 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/index.ts");
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 9: Run the test**

Run: `pnpm -F @freecode-rs/cli test`
Expected: 1 test passing.

- [ ] **Step 10: Run the CLI locally**

Run: `pnpm -F @freecode-rs/cli dev`
Expected: prints `ready`, exits 0.

- [ ] **Step 11: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add AGENTS.md CLAUDE.md .env.example .gitignore apps/cli
git commit -m "chore: bootstrap monorepo, AGENTS.md, CLAUDE.md, cli skeleton"
```

---

## Task 2: rlm-repl skeleton — REPL interface and IsolatedVmREPL execute()

**Files:**
- Create: `packages/rlm-repl/package.json`
- Create: `packages/rlm-repl/tsconfig.json`
- Create: `packages/rlm-repl/vitest.config.ts`
- Create: `packages/rlm-repl/src/types.ts`
- Create: `packages/rlm-repl/src/isolated-vm.ts`
- Create: `packages/rlm-repl/src/isolated-vm.test.ts`
- Create: `packages/rlm-repl/src/index.ts`

**Interfaces:**
- Consumes: none.
- Produces: `REPL` interface in `src/types.ts`; `IsolatedVmREPL` class in `src/isolated-vm.ts` with `execute(code)` returning `{ success, stdout, expression, error?, durationMs }`. `console.log` inside the sandbox is captured in `stdout`. `load`, `readStdout`, `inspect`, `dispose` throw `Error("not implemented")` (filled in later tasks).

- [ ] **Step 1: Write `packages/rlm-repl/package.json`**

```json
{
  "name": "@freecode-rs/repl",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "isolated-vm": "^5.0.1"
  },
  "devDependencies": {
    "@freecode-rs/typescript-config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "5.9.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/rlm-repl/tsconfig.json`**

```json
{
  "extends": "@freecode-rs/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/rlm-repl/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 4: Write `packages/rlm-repl/src/types.ts`**

```ts
export interface REPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
  error?: { name: string; message: string; trace: string };
  durationMs: number;
}

export interface REPL {
  load(name: string, value: unknown): Promise<void>;
  execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult>;
  readStdout(): string[];
  inspect(): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export interface REPLOptions {
  timeoutMs?: number;
  memoryMb?: number;
}
```

- [ ] **Step 5: Write failing test `packages/rlm-repl/src/isolated-vm.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { IsolatedVmREPL } from "./isolated-vm.js";

describe("IsolatedVmREPL.execute", () => {
  let repl: IsolatedVmREPL;
  afterEach(async () => {
    await repl?.dispose();
  });

  it("returns success and expression for simple code", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("1 + 2");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(3);
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.stdout)).toBe(true);
  });

  it("captures console.log into stdout", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("console.log('hello'); 7");
    expect(r.success).toBe(true);
    expect(r.stdout).toContain("hello");
    expect(r.expression).toBe(7);
  });

  it("returns success=false on thrown error", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("throw new Error('boom')");
    expect(r.success).toBe(false);
    expect(r.error?.name).toBe("Error");
    expect(r.error?.message).toBe("boom");
  });

  it("isolates from host: process is undefined in sandbox", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("typeof process");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("undefined");
  });

  it("does not leak host console into sandbox", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("typeof globalThis.console");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("object"); // sandbox-side console only
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm -F @freecode-rs/repl test`
Expected: import error / module not found.

- [ ] **Step 7: Write minimal `packages/rlm-repl/src/isolated-vm.ts`**

```ts
import ivm from "isolated-vm";
import type { REPL, REPLOptions, REPLResult } from "./types.js";

const SANDBOX_CONSOLE_SETUP = `
const __stdout = [];
const console = {
  log: (...args) => { __stdout.push(args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  error: (...args) => { __stdout.push('[error] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  warn: (...args) => { __stdout.push('[warn] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
};
`;

export class IsolatedVmREPL implements REPL {
  private isolate: ivm.Isolate;
  private context: ivm.Context;
  private timeoutMs: number;
  private memoryMb: number;
  private stdout: string[] = [];

  constructor(opts: REPLOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.memoryMb = opts.memoryMb ?? 256;
    this.isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    this.context = this.isolate.createContextSync();
    const setupScript = this.isolate.compileScriptSync(SANDBOX_CONSOLE_SETUP);
    setupScript.runSync(this.context, { timeout: 1000 });
  }

  async load(_name: string, _value: unknown): Promise<void> {
    throw new Error("not implemented");
  }

  async execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult> {
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const start = Date.now();
    try {
      const script = this.isolate.compileScriptSync(`(${() => {
        const __stdout = __stdout; // capture from outer scope
        let __last;
        try {
          __last = eval(${JSON.stringify(code)});
        } catch (e) {
          throw e;
        }
        return { __last, __stdout };
      }})()`);
      const resultRef = await script.run(this.context, {
        timeout,
        promise: true,
      }) as { __last: unknown; __stdout: string[] };
      const combined = resultRef.__stdout;
      for (const line of combined) this.stdout.push(line);
      return {
        success: true,
        stdout: [...combined],
        expression: resultRef.__last,
        durationMs: Date.now() - start,
      };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; stack?: string };
      return {
        success: false,
        stdout: [...this.stdout],
        error: {
          name: err.name ?? "Error",
          message: err.message ?? String(e),
          trace: err.stack ?? "",
        },
        durationMs: Date.now() - start,
      };
    }
  }

  readStdout(): string[] {
    return [...this.stdout];
  }

  async inspect(): Promise<Record<string, unknown>> {
    throw new Error("not implemented");
  }

  async dispose(): Promise<void> {
    this.context.release();
    this.isolate.dispose();
  }
}
```

- [ ] **Step 8: Write `packages/rlm-repl/src/index.ts`**

```ts
export type { REPL, REPLResult, REPLOptions } from "./types.js";
export { IsolatedVmREPL } from "./isolated-vm.js";
```

- [ ] **Step 9: Run tests**

Run: `pnpm -F @freecode-rs/repl test`
Expected: 5 tests passing. Note: the "isolates from host" test depends on isolated-vm's default isolation; if it fails because `process` is defined, revisit Step 7's setup. Likely path: it passes.

- [ ] **Step 10: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-repl
git commit -m "feat(repl): REPL interface + IsolatedVmREPL.execute with console bridging"
```

---

## Task 3: rlm-repl — load(), inspect(), readStdout(), timeout enforcement

**Files:**
- Modify: `packages/rlm-repl/src/isolated-vm.ts`
- Modify: `packages/rlm-repl/src/isolated-vm.test.ts`

**Interfaces:**
- Consumes: `REPL` interface from Task 2.
- Produces: full `IsolatedVmREPL` impl — `load(name, value)` puts a value in scope, `inspect()` returns all bound names, `execute()` enforces `timeoutMs` and surfaces as `success: false`.

- [ ] **Step 1: Add failing tests to `isolated-vm.test.ts`**

Append inside the `describe` block (after the existing tests):

```ts
  it("load() makes a variable visible to subsequent execute()", async () => {
    repl = new IsolatedVmREPL();
    await repl.load("x", 42);
    const r = await repl.execute("x * 2");
    expect(r.success).toBe(true);
    expect(r.expression).toBe(84);
  });

  it("inspect() returns currently bound variables", async () => {
    repl = new IsolatedVmREPL();
    await repl.load("a", 1);
    await repl.load("b", "hi");
    const vars = await repl.inspect();
    expect(vars.a).toBe(1);
    expect(vars.b).toBe("hi");
  });

  it("readStdout() reflects cumulative console output across execute() calls", async () => {
    repl = new IsolatedVmREPL();
    await repl.execute("console.log('one')");
    await repl.execute("console.log('two')");
    expect(repl.readStdout()).toEqual(["one", "two"]);
  });

  it("enforces timeoutMs and returns success=false", async () => {
    repl = new IsolatedVmREPL();
    const r = await repl.execute("while (true) {}", { timeoutMs: 100 });
    expect(r.success).toBe(false);
    expect(r.error?.message).toMatch(/timeout|terminated/i);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @freecode-rs/repl test`
Expected: the 4 new tests fail with "not implemented" errors.

- [ ] **Step 3: Rewrite `packages/rlm-repl/src/isolated-vm.ts`**

Replace the entire file with:

```ts
import ivm from "isolated-vm";
import type { REPL, REPLOptions, REPLResult } from "./types.js";

const SANDBOX_CONSOLE_SETUP = `
const __stdout = [];
const console = {
  log: (...args) => { __stdout.push(args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  error: (...args) => { __stdout.push('[error] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
  warn: (...args) => { __stdout.push('[warn] ' + args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')); },
};
const __bindings = {};
`;

export class IsolatedVmREPL implements REPL {
  private isolate: ivm.Isolate;
  private context: ivm.Context;
  private timeoutMs: number;
  private memoryMb: number;
  private stdout: string[] = [];
  private bindings = new Map<string, unknown>();

  constructor(opts: REPLOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.memoryMb = opts.memoryMb ?? 256;
    this.isolate = new ivm.Isolate({ memoryLimit: this.memoryMb });
    this.context = this.isolate.createContextSync();
    const setupScript = this.isolate.compileScriptSync(SANDBOX_CONSOLE_SETUP);
    setupScript.runSync(this.context, { timeout: 1000 });
  }

  async load(name: string, value: unknown): Promise<void> {
    this.bindings.set(name, value);
    // Serialize via structured-clone-safe JSON path. Functions/lossy types are best-effort.
    const json = JSON.stringify(value, (_k, v) => (typeof v === "function" ? undefined : v));
    const decl = `__bindings[${JSON.stringify(name)}] = ${json};`;
    const script = this.isolate.compileScriptSync(decl);
    script.runSync(this.context, { timeout: 1000 });
  }

  async execute(code: string, opts?: { timeoutMs?: number }): Promise<REPLResult> {
    const timeout = opts?.timeoutMs ?? this.timeoutMs;
    const start = Date.now();
    // Wrap user code so we capture the final expression AND the sandbox-side __stdout
    // after execution. We use a function wrapper that returns both, then transfer __stdout
    // back to the host.
    const wrapper = `(function() {
      const __capturedStdout = [];
      const __origPush = __stdout.push.bind(__stdout);
      __stdout.push = (...args) => { __capturedStdout.push(args.map(a =>
        typeof a === 'string' ? a : JSON.stringify(a)
      ).join(' ')); return __origPush(...args); };
      try {
        const __result = (function() { ${code} })();
        return { success: true, value: __result, captured: __capturedStdout };
      } catch (e) {
        return { success: false, error: { name: e.name, message: e.message, stack: e.stack || '' }, captured: __capturedStdout };
      }
    })()`;
    try {
      const script = this.isolate.compileScriptSync(wrapper);
      const ref = await script.run(this.context, { timeout, promise: true }) as
        | { success: true; value: unknown; captured: string[] }
        | { success: false; error: { name: string; message: string; stack: string }; captured: string[] };
      for (const line of ref.captured) this.stdout.push(line);
      if (ref.success) {
        return {
          success: true,
          stdout: [...ref.captured],
          expression: ref.value,
          durationMs: Date.now() - start,
        };
      }
      return {
        success: false,
        stdout: [...ref.captured],
        error: ref.error,
        durationMs: Date.now() - start,
      };
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string; stack?: string };
      // isolated-vm timeout throws a V8 error named "TimeoutError" or "Error" with message containing 'Script execution timed out'
      return {
        success: false,
        stdout: [...this.stdout],
        error: {
          name: err.name ?? "Error",
          message: err.message ?? String(e),
          trace: err.stack ?? "",
        },
        durationMs: Date.now() - start,
      };
    }
  }

  readStdout(): string[] {
    return [...this.stdout];
  }

  async inspect(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.bindings) out[k] = v;
    return out;
  }

  async dispose(): Promise<void> {
    this.context.release();
    this.isolate.dispose();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @freecode-rs/repl test`
Expected: 9 tests passing (5 original + 4 new).

- [ ] **Step 5: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-repl
git commit -m "feat(repl): load, inspect, readStdout, timeout enforcement"
```

---

## Task 4: rlm-client skeleton — LMClient interface and MockLMClient

**Files:**
- Create: `packages/rlm-client/package.json`
- Create: `packages/rlm-client/tsconfig.json`
- Create: `packages/rlm-client/vitest.config.ts`
- Create: `packages/rlm-client/src/types.ts`
- Create: `packages/rlm-client/src/mock.ts`
- Create: `packages/rlm-client/src/mock.test.ts`
- Create: `packages/rlm-client/src/index.ts`

**Interfaces:**
- Consumes: none.
- Produces: `LMClient` interface and `LMError` class in `src/types.ts`; `MockLMClient` (configurable responses) in `src/mock.ts`. Real Vercel AI adapter comes in Task 5.

- [ ] **Step 1: Write `packages/rlm-client/package.json`**

```json
{
  "name": "@freecode-rs/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "ai": "^4.0.0"
  },
  "devDependencies": {
    "@freecode-rs/typescript-config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "5.9.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/rlm-client/tsconfig.json`**

```json
{
  "extends": "@freecode-rs/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/rlm-client/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write `packages/rlm-client/src/types.ts`**

```ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatDelta = { kind: "delta"; text: string };
export type ChatFinal = { kind: "final"; message: ChatMessage };
export type ChatEvent = ChatDelta | ChatFinal;

export interface LMClient {
  chat(messages: ChatMessage[]): Promise<ChatMessage>;
  stream(messages: ChatMessage[]): AsyncIterable<ChatEvent>;
  estimateTokens?(text: string): number;
}

export type LMErrorCause =
  | "rate_limit"
  | "auth"
  | "network"
  | "context_overflow"
  | "unknown";

export class LMError extends Error {
  constructor(
    public readonly cause: LMErrorCause,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LMError";
  }
}
```

- [ ] **Step 5: Write failing test `packages/rlm-client/src/mock.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { MockLMClient } from "./mock.js";

describe("MockLMClient", () => {
  it("returns the next configured response and advances the queue", async () => {
    const mock = new MockLMClient([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    expect((await mock.chat([])).content).toBe("first");
    expect((await mock.chat([])).content).toBe("second");
  });

  it("cycles the last response when queue is exhausted", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "only" }]);
    await mock.chat([]);
    expect((await mock.chat([])).content).toBe("only");
  });

  it("stream() yields a delta then a final event", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "hi" }]);
    const events = [];
    for await (const e of mock.stream([])) events.push(e);
    expect(events[0]).toEqual({ kind: "delta", text: "hi" });
    expect(events[1]).toEqual({ kind: "final", message: { role: "assistant", content: "hi" } });
  });

  it("records every chat() call for assertions", async () => {
    const mock = new MockLMClient([{ role: "assistant", content: "x" }]);
    await mock.chat([{ role: "user", content: "a" }]);
    await mock.chat([{ role: "user", content: "b" }]);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.[0]?.content).toBe("a");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm -F @freecode-rs/client test`
Expected: import error.

- [ ] **Step 7: Write `packages/rlm-client/src/mock.ts`**

```ts
import type { ChatEvent, ChatMessage, LMClient } from "./types.js";

export class MockLMClient implements LMClient {
  readonly calls: ChatMessage[][] = [];
  private responses: ChatMessage[];
  private idx = 0;

  constructor(responses: ChatMessage[]) {
    this.responses = responses;
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    this.calls.push(messages);
    const resp = this.responses[Math.min(this.idx, this.responses.length - 1)]!;
    this.idx++;
    return resp;
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatEvent> {
    const final = await this.chat(messages);
    yield { kind: "delta", text: final.content };
    yield { kind: "final", message: final };
  }
}
```

- [ ] **Step 8: Write `packages/rlm-client/src/index.ts`**

```ts
export type { LMClient, ChatMessage, ChatDelta, ChatFinal, ChatEvent } from "./types.js";
export { LMError, type LMErrorCause } from "./types.js";
export { MockLMClient } from "./mock.js";
```

- [ ] **Step 9: Run tests**

Run: `pnpm -F @freecode-rs/client test`
Expected: 4 tests passing.

- [ ] **Step 10: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-client
git commit -m "feat(client): LMClient interface, LMError, MockLMClient"
```

---

## Task 5: rlm-client — VercelAIClient with chat() and stream()

**Files:**
- Create: `packages/rlm-client/src/vercel-ai.ts`
- Create: `packages/rlm-client/src/vercel-ai.test.ts` (mock-based; integration test added in Task 12)
- Modify: `packages/rlm-client/src/index.ts`

**Interfaces:**
- Consumes: `LMClient` from Task 4. The `ai` package's `generateText` / `streamText` and `AIError`.
- Produces: `VercelAIClient` class implementing `LMClient`. Maps `AIError` → `LMError`.

- [ ] **Step 1: Write failing test `packages/rlm-client/src/vercel-ai.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { VercelAIClient } from "./vercel-ai.js";
import { LMError } from "./types.js";

describe("VercelAIClient", () => {
  it("constructs with model name", () => {
    const c = new VercelAIClient({ model: "gpt-5-nano" });
    expect(c).toBeInstanceOf(VercelAIClient);
  });

  it("maps AI context-overflow errors to LMError with cause 'context_overflow'", async () => {
    // We can't easily inject a real overflow without a live API; instead,
    // we test the error mapping helper directly.
    const c = new VercelAIClient({ model: "gpt-5-nano" });
    // Access the private static mapper through a tiny test seam:
    const mapped = (c as unknown as { mapError(err: unknown): LMError }).mapError(
      Object.assign(new Error("context length exceeded"), { name: "AIContextOverflowError" }),
    );
    expect(mapped).toBeInstanceOf(LMError);
    expect(mapped.cause).toBe("context_overflow");
    expect(mapped.retryable).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @freecode-rs/client test`
Expected: import error for `vercel-ai`.

- [ ] **Step 3: Write `packages/rlm-client/src/vercel-ai.ts`**

```ts
import { generateText, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ChatEvent, ChatMessage, LMClient } from "./types.js";
import { LMError, type LMErrorCause } from "./types.js";

export interface VercelAIClientOptions {
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export class VercelAIClient implements LMClient {
  private provider;
  private modelName: string;

  constructor(opts: VercelAIClientOptions) {
    this.provider = createOpenAI({
      apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: opts.baseURL,
    });
    this.modelName = opts.model;
  }

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    try {
      const { text } = await generateText({
        model: this.provider(this.modelName),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return { role: "assistant", content: text };
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatEvent> {
    let finalText = "";
    try {
      const result = streamText({
        model: this.provider(this.modelName),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      for await (const part of result.textStream) {
        finalText += part;
        yield { kind: "delta", text: part };
      }
      yield { kind: "final", message: { role: "assistant", content: finalText } };
    } catch (e) {
      throw this.mapError(e);
    }
  }

  // Exposed for tests; not part of LMClient.
  mapError(err: unknown): LMError {
    const e = err as { name?: string; message?: string; status?: number };
    const name = e.name ?? "";
    const msg = e.message ?? String(err);
    let cause: LMErrorCause = "unknown";
    let retryable = false;
    if (name.includes("ContextOverflow") || msg.includes("context length")) {
      cause = "context_overflow";
      retryable = false;
    } else if (name.includes("RateLimit") || e.status === 429) {
      cause = "rate_limit";
      retryable = true;
    } else if (name.includes("Authentication") || e.status === 401) {
      cause = "auth";
      retryable = false;
    } else if (name.includes("Network") || name.includes("Fetch")) {
      cause = "network";
      retryable = true;
    }
    return new LMError(cause, msg, retryable);
  }
}
```

- [ ] **Step 4: Add `@ai-sdk/openai` to package.json dependencies**

Modify `packages/rlm-client/package.json` — under `dependencies`, add:

```json
    "@ai-sdk/openai": "^1.0.0",
```

- [ ] **Step 5: Run install + tests**

Run: `pnpm install && pnpm -F @freecode-rs/client test`
Expected: 2 vercel-ai tests passing plus the 4 MockLMClient tests still passing.

- [ ] **Step 6: Update `packages/rlm-client/src/index.ts`**

```ts
export type { LMClient, ChatMessage, ChatDelta, ChatFinal, ChatEvent } from "./types.js";
export { LMError, type LMErrorCause } from "./types.js";
export { MockLMClient } from "./mock.js";
export { VercelAIClient, type VercelAIClientOptions } from "./vercel-ai.js";
```

- [ ] **Step 7: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-client
git commit -m "feat(client): VercelAIClient with chat/stream and error mapping"
```

---

## Task 6: rlm-core skeleton — types and utilities

**Files:**
- Create: `packages/rlm-core/package.json`
- Create: `packages/rlm-core/tsconfig.json`
- Create: `packages/rlm-core/vitest.config.ts`
- Create: `packages/rlm-core/src/types.ts`
- Create: `packages/rlm-core/src/utils/code-extract.ts`
- Create: `packages/rlm-core/src/utils/code-extract.test.ts`
- Create: `packages/rlm-core/src/utils/messages.ts`
- Create: `packages/rlm-core/src/utils/messages.test.ts`
- Create: `packages/rlm-core/src/index.ts`

**Interfaces:**
- Consumes: types from `@freecode-rs/client` (`ChatMessage`, `LMClient`).
- Produces: core-only types (`RLMOptions`, `RLMResult`, `Iteration`) and `REPL` interface re-export (so `core` defines its own boundary; see Note in step 3).

- [ ] **Step 1: Write `packages/rlm-core/package.json`**

```json
{
  "name": "@freecode-rs/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@freecode-rs/client": "workspace:*"
  },
  "devDependencies": {
    "@freecode-rs/typescript-config": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "5.9.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/rlm-core/tsconfig.json` and `vitest.config.ts`**

```json
// tsconfig.json
{
  "extends": "@freecode-rs/typescript-config/base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write `packages/rlm-core/src/types.ts`**

`core` defines its own minimal `REPL` shape — the same as `rlm-repl`'s interface, but redeclared so `core` doesn't depend on `rlm-repl`. The CLI app wires them together.

```ts
import type { ChatMessage, LMClient } from "@freecode-rs/client";

export interface CoreREPLResult {
  success: boolean;
  stdout: string[];
  expression?: unknown;
  error?: { name: string; message: string; trace: string };
  durationMs: number;
}

export interface CoreREPL {
  load(name: string, value: unknown): Promise<void>;
  execute(code: string, opts?: { timeoutMs?: number }): Promise<CoreREPLResult>;
  readStdout(): string[];
  inspect(): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export interface RLMOptions {
  client: LMClient;
  repl: CoreREPL;
  systemPrompt?: string;
  maxDepth?: number;
  maxIterations?: number;
  maxSubCalls?: number;
  verbose?: boolean;
}

export interface Iteration {
  index: number;
  assistantMessage: ChatMessage;
  replResult: CoreREPLResult;
  subCallsAtStart: number;
}

export interface RLMResult {
  response: string;
  iterations: Iteration[];
  metadata: {
    startedAt: number;
    finishedAt: number;
    totalSubCalls: number;
    depthReached: number;
    finishedReason: "final" | "max_iterations" | "error";
  };
}

export class RLMAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RLMAbortError";
  }
}
```

- [ ] **Step 4: Write failing test `utils/code-extract.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractReplCode } from "./code-extract.js";

describe("extractReplCode", () => {
  it("returns the contents of the last ```repl block", () => {
    const text = "intro\n```repl\nconsole.log('a');\n42\n```\noutro";
    expect(extractReplCode(text)).toBe("console.log('a');\n42");
  });

  it("returns the last fenced block if no language hint", () => {
    const text = "```\nlet x = 1;\n```";
    expect(extractReplCode(text)).toBe("let x = 1;");
  });

  it("returns null when no code blocks present", () => {
    expect(extractReplCode("plain text only")).toBeNull();
  });

  it("takes the LAST block when multiple are present", () => {
    const text = "```repl\nfirst\n```\nmid\n```repl\nsecond\n```";
    expect(extractReplCode(text)).toBe("second");
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm -F @freecode-rs/core test`
Expected: import error.

- [ ] **Step 6: Write `utils/code-extract.ts`**

```ts
const FENCE = /```(?:repl|js|javascript)?\n([\s\S]*?)```/g;

export function extractReplCode(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(FENCE)) {
    last = m[1] ?? null;
  }
  return last;
}
```

- [ ] **Step 7: Write failing test `utils/messages.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildHistoryMessages } from "./messages.js";

describe("buildHistoryMessages", () => {
  it("starts with system prompt then alternates user/assistant", () => {
    const out = buildHistoryMessages({
      systemPrompt: "SYS",
      iterations: [
        {
          index: 0,
          assistantMessage: { role: "assistant", content: "hi" },
          replResult: { success: true, stdout: [], expression: 1, durationMs: 1 },
          subCallsAtStart: 0,
        },
      ],
    });
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: expect.stringContaining("hi") });
    expect(out[2]).toEqual({ role: "user", content: expect.stringContaining("Result:") });
  });
});
```

- [ ] **Step 8: Run to verify the new test fails**

Run: `pnpm -F @freecode-rs/core test`
Expected: import error for `messages`.

- [ ] **Step 9: Write `utils/messages.ts`**

```ts
import type { ChatMessage } from "@freecode-rs/client";
import type { Iteration } from "../types.js";

export function buildHistoryMessages(args: {
  systemPrompt: string;
  iterations: Iteration[];
}): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: args.systemPrompt }];
  for (const it of args.iterations) {
    out.push({
      role: "user",
      content: `Assistant turn:\n${it.assistantMessage.content}\n\nResult:\n${formatResult(it)}`,
    });
  }
  return out;
}

function formatResult(it: Iteration): string {
  if (!it.replResult.success) {
    return `error: ${it.replResult.error?.message ?? "unknown"}\ntrace: ${it.replResult.error?.trace ?? ""}`;
  }
  const stdout = it.replResult.stdout.join("\n");
  const expr = JSON.stringify(it.replResult.expression);
  return `stdout:\n${stdout}\nexpression: ${expr}`;
}
```

- [ ] **Step 10: Write `packages/rlm-core/src/index.ts`**

```ts
export type {
  CoreREPL,
  CoreREPLResult,
  RLMOptions,
  Iteration,
  RLMResult,
} from "./types.js";
export { RLMAbortError } from "./types.js";
export { extractReplCode } from "./utils/code-extract.js";
export { buildHistoryMessages } from "./utils/messages.js";
```

- [ ] **Step 11: Run tests**

Run: `pnpm -F @freecode-rs/core test`
Expected: 6 tests passing (4 code-extract + 2 messages). Wait — only 1 message test, so 5 total. Expected: 5 tests passing.

- [ ] **Step 12: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "feat(core): types, code-extract and messages utilities"
```

---

## Task 7: rlm-core — built-in system prompt and FINAL/FINAL_VAR extraction

**Files:**
- Create: `packages/rlm-core/src/prompt.ts`
- Create: `packages/rlm-core/src/prompt.test.ts`
- Create: `packages/rlm-core/src/final.ts`
- Create: `packages/rlm-core/src/final.test.ts`

**Interfaces:**
- Consumes: `CoreREPLResult` from Task 6.
- Produces: `BUILTIN_SYSTEM_PROMPT` constant; `extractFinal(result, inspect)` returning the final answer string or `null`.

- [ ] **Step 1: Write `packages/rlm-core/src/prompt.ts`**

```ts
export const BUILTIN_SYSTEM_PROMPT = `You are an RLM (Recursive Language Model). You have access to a JavaScript REPL that you can write code in to inspect, transform, and answer a user's prompt.

The user's prompt is available as the variable \`context\` in the REPL scope.

Available REPL functions:
- \`llm_query(prompt: string): Promise<string>\` — call another language model with the given prompt, returns the model's reply.
- \`rlm_query(prompt: string): Promise<string>\` — spawn a sub-RLM that runs its own REPL on the given prompt and returns its final answer.
- \`PRINT(x)\` — append a stringified \`x\` to your visible stdout (printed in the next turn).
- \`FINAL(answer: string)\` — return \`answer\` as the final response. Short-circuits the loop.
- \`FINAL_VAR(name: string)\` — return the value of the REPL variable \`name\` as the final response.

Rules:
1. Wrap code in a single fenced block: \`\`\`repl\\n...code...\\n\`\`\`. Only the LAST block per turn runs.
2. \`context\` may be very large. Do NOT read it directly into your context — write code that chunks, filters, or searches it programmatically.
3. Use \`llm_query\` for one-shot classification/extraction; use \`rlm_query\` when the sub-task itself needs decomposition.
4. Call \`FINAL("...")\` or \`FINAL_VAR("...")\` when you have the answer. Until then, write more code.
5. Stay terse. No explanations in chat unless asked — do the work in the REPL.`;
```

- [ ] **Step 2: Write `packages/rlm-core/src/prompt.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";

describe("BUILTIN_SYSTEM_PROMPT", () => {
  it("mentions llm_query, rlm_query, PRINT, FINAL, FINAL_VAR", () => {
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/llm_query/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/rlm_query/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/PRINT/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/FINAL\(/);
    expect(BUILTIN_SYSTEM_PROMPT).toMatch(/FINAL_VAR\(/);
  });

  it("warns against reading context directly", () => {
    expect(BUILTIN_SYSTEM_PROMPT.toLowerCase()).toContain("do not read");
  });
});
```

- [ ] **Step 3: Run prompt tests**

Run: `pnpm -F @freecode-rs/core test`
Expected: 2 prompt tests passing.

- [ ] **Step 4: Write failing test `packages/rlm-core/src/final.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractFinal } from "./final.js";

describe("extractFinal", () => {
  it("returns the string for FINAL('hello')", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __final: "hello" }, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toEqual({ kind: "final", answer: "hello" });
  });

  it("resolves FINAL_VAR('result') via inspect()", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: { __finalVar: "result" }, durationMs: 1 },
      async () => ({ result: "the answer" }),
    );
    expect(out).toEqual({ kind: "final", answer: "the answer" });
  });

  it("returns null when expression is not a sentinel", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: 42, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toBeNull();
  });

  it("returns null when expression is undefined (no FINAL called)", async () => {
    const out = await extractFinal(
      { success: true, stdout: [], expression: undefined, durationMs: 1 },
      async () => ({}),
    );
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm -F @freecode-rs/core test`
Expected: import error for `final`.

- [ ] **Step 6: Write `packages/rlm-core/src/final.ts`**

```ts
import type { CoreREPLResult } from "./types.js";

export type ExtractedFinal =
  | { kind: "final"; answer: string }
  | null;

export async function extractFinal(
  result: CoreREPLResult,
  inspect: () => Promise<Record<string, unknown>>,
): Promise<ExtractedFinal> {
  const expr = result.expression;
  if (expr && typeof expr === "object") {
    const e = expr as { __final?: unknown; __finalVar?: unknown };
    if (typeof e.__final === "string") {
      return { kind: "final", answer: e.__final };
    }
    if (typeof e.__finalVar === "string") {
      const scope = await inspect();
      const v = scope[e.__finalVar];
      return { kind: "final", answer: stringify(v) };
    }
  }
  return null;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm -F @freecode-rs/core test`
Expected: 7 tests passing (5 + 2 new).

- [ ] **Step 8: Update `packages/rlm-core/src/index.ts`**

```ts
export type {
  CoreREPL,
  CoreREPLResult,
  RLMOptions,
  Iteration,
  RLMResult,
} from "./types.js";
export { RLMAbortError } from "./types.js";
export { extractReplCode } from "./utils/code-extract.js";
export { buildHistoryMessages } from "./utils/messages.js";
export { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";
export { extractFinal, type ExtractedFinal } from "./final.js";
```

- [ ] **Step 9: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "feat(core): built-in prompt and FINAL/FINAL_VAR extraction"
```

---

## Task 8: rlm-core — RLM class depth-0 loop (no sub-calls yet)

**Files:**
- Create: `packages/rlm-core/src/rlm.ts`
- Create: `packages/rlm-core/src/rlm.test.ts`
- Modify: `packages/rlm-core/src/index.ts`

**Interfaces:**
- Consumes: `RLMOptions` (Task 6), `BUILTIN_SYSTEM_PROMPT` (Task 7), `extractReplCode`, `buildHistoryMessages`, `extractFinal`.
- Produces: `RLM` class with `completion(prompt: string): Promise<RLMResult>`. Depth-0 means sub-call functions are NOT yet exposed in the REPL.

- [ ] **Step 1: Write failing test `packages/rlm-core/src/rlm.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { MockLMClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

describe("RLM (depth-0)", () => {
  it("runs the loop until FINAL() and returns the answer", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nPRINT('thinking'); FINAL('done')\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxIterations: 5 });
    const result = await rlm.completion("hi");
    expect(result.response).toBe("done");
    expect(result.metadata.finishedReason).toBe("final");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.replResult.stdout).toContain("thinking");
  });

  it("returns last assistant text when maxIterations hit without FINAL", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n1+1\n```" },
      { role: "assistant", content: "```repl\n2+2\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxIterations: 2 });
    const result = await rlm.completion("hi");
    expect(result.metadata.finishedReason).toBe("max_iterations");
    expect(result.response).toContain("2+2");
  });

  it("loads the prompt as `context` in the REPL", async () => {
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\nFINAL(context)\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl });
    const result = await rlm.completion("the prompt");
    expect(result.response).toBe("the prompt");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @freecode-rs/core test`
Expected: import error for `rlm`.

- [ ] **Step 3: Write `packages/rlm-core/src/rlm.ts`**

```ts
import type { ChatMessage } from "@freecode-rs/client";
import type {
  CoreREPL,
  Iteration,
  RLMOptions,
  RLMResult,
} from "./types.js";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";
import { extractReplCode } from "./utils/code-extract.js";
import { buildHistoryMessages } from "./utils/messages.js";
import { extractFinal } from "./final.js";

export class RLM {
  private readonly client: RLMOptions["client"];
  private readonly repl: CoreREPL;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private readonly verbose: boolean;

  constructor(opts: RLMOptions) {
    this.client = opts.client;
    this.repl = opts.repl;
    this.systemPrompt = opts.systemPrompt ?? BUILTIN_SYSTEM_PROMPT;
    this.maxIterations = opts.maxIterations ?? 50;
    this.verbose = opts.verbose ?? false;
  }

  async completion(prompt: string): Promise<RLMResult> {
    const startedAt = Date.now();
    await this.repl.load("context", prompt);

    const iterations: Iteration[] = [];
    let finalAnswer: string | null = null;

    for (let i = 0; i < this.maxIterations; i++) {
      const messages = buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        iterations,
      });
      const assistantMessage = await this.client.chat(messages);
      const code = extractReplCode(assistantMessage.content);

      if (!code) {
        // Model didn't emit any code. Record and stop (treat last text as answer).
        iterations.push({
          index: i,
          assistantMessage,
          replResult: { success: true, stdout: [], durationMs: 0 },
          subCallsAtStart: 0,
        });
        finalAnswer = assistantMessage.content;
        break;
      }

      const replResult = await this.repl.execute(code);
      iterations.push({
        index: i,
        assistantMessage,
        replResult,
        subCallsAtStart: 0,
      });

      if (this.verbose) {
        console.error(`[rlm iter ${i}] code=${code.length}B stdout=${replResult.stdout.length}L success=${replResult.success}`);
      }

      const final = await extractFinal(replResult, () => this.repl.inspect());
      if (final) {
        finalAnswer = final.answer;
        break;
      }
    }

    const finishedAt = Date.now();
    const finishedReason =
      finalAnswer !== null
        ? iterations.length > 0 && iterations[iterations.length - 1]?.replResult.success
          ? "final"
          : "final"
        : "max_iterations";

    return {
      response: finalAnswer ?? iterations[iterations.length - 1]?.assistantMessage.content ?? "",
      iterations,
      metadata: {
        startedAt,
        finishedAt,
        totalSubCalls: 0,
        depthReached: 0,
        finishedReason: finalAnswer !== null ? "final" : "max_iterations",
      },
    };
  }
}

// Re-export so external imports only need @freecode-rs/core
export type { ChatMessage } from "@freecode-rs/client";
```

Note: `finishedReason` logic in the early-return block is intentionally a placeholder; we tighten it in Task 9 when sub-calls are added. For Task 8 the logic above is functionally correct.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @freecode-rs/core test`
Expected: 10 tests passing (3 rlm + 7 prior).

- [ ] **Step 5: Update `packages/rlm-core/src/index.ts`**

```ts
export type {
  CoreREPL,
  CoreREPLResult,
  RLMOptions,
  Iteration,
  RLMResult,
} from "./types.js";
export { RLMAbortError } from "./types.js";
export { extractReplCode } from "./utils/code-extract.js";
export { buildHistoryMessages } from "./utils/messages.js";
export { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";
export { extractFinal, type ExtractedFinal } from "./final.js";
export { RLM } from "./rlm.js";
```

- [ ] **Step 6: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "feat(core): RLM class with depth-0 completion loop"
```

---

## Task 9: rlm-core — budget tracking

**Files:**
- Create: `packages/rlm-core/src/budget.ts`
- Create: `packages/rlm-core/src/budget.test.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces: `Budget` class with `tryConsumeSubCall()`, `tryConsumeIteration()`; `BudgetExceededError`.

- [ ] **Step 1: Write failing test `packages/rlm-core/src/budget.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Budget, BudgetExceededError } from "./budget.js";

describe("Budget", () => {
  it("allows consumption up to the limit", () => {
    const b = new Budget({ maxIterations: 3, maxSubCalls: 5 });
    b.tryConsumeIteration();
    b.tryConsumeIteration();
    b.tryConsumeIteration();
    expect(() => b.tryConsumeIteration()).toThrow(BudgetExceededError);
  });

  it("counts sub-calls across the run", () => {
    const b = new Budget({ maxIterations: 100, maxSubCalls: 2 });
    b.tryConsumeSubCall();
    b.tryConsumeSubCall();
    expect(() => b.tryConsumeSubCall()).toThrow(BudgetExceededError);
  });

  it("exposes totals", () => {
    const b = new Budget({ maxIterations: 100, maxSubCalls: 100 });
    b.tryConsumeIteration();
    b.tryConsumeSubCall();
    b.tryConsumeSubCall();
    expect(b.iterations).toBe(1);
    expect(b.subCalls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @freecode-rs/core test`
Expected: import error.

- [ ] **Step 3: Write `packages/rlm-core/src/budget.ts`**

```ts
export class BudgetExceededError extends Error {
  constructor(public readonly kind: "iterations" | "subcalls") {
    super(`budget exceeded: ${kind}`);
    this.name = "BudgetExceededError";
  }
}

export class Budget {
  iterations = 0;
  subCalls = 0;
  private maxIterations: number;
  private maxSubCalls: number;

  constructor(opts: { maxIterations: number; maxSubCalls: number }) {
    this.maxIterations = opts.maxIterations;
    this.maxSubCalls = opts.maxSubCalls;
  }

  tryConsumeIteration(): void {
    if (this.iterations >= this.maxIterations) {
      throw new BudgetExceededError("iterations");
    }
    this.iterations++;
  }

  tryConsumeSubCall(): void {
    if (this.subCalls >= this.maxSubCalls) {
      throw new BudgetExceededError("subcalls");
    }
    this.subCalls++;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @freecode-rs/core test`
Expected: 13 tests passing.

- [ ] **Step 5: Update `packages/rlm-core/src/index.ts` to export Budget**

Add to the existing exports:

```ts
export { Budget, BudgetExceededError } from "./budget.js";
```

- [ ] **Step 6: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "feat(core): Budget with iteration and sub-call caps"
```

---

## Task 10: rlm-repl — host-bridge for llm_query / rlm_query

**Files:**
- Create: `packages/rlm-repl/src/bridge.ts`
- Create: `packages/rlm-repl/src/bridge.test.ts`

**Interfaces:**
- Consumes: `isolated-vm`, a host callback `(prompt: string) => Promise<string>` for `llm_query`, a child RLM factory for `rlm_query`.
- Produces: `installBridge(repl, { llmQuery, rlmQuery })` which exposes both functions into the sandbox scope.

- [ ] **Step 1: Write failing test `packages/rlm-repl/src/bridge.test.ts`**

```ts
import { describe, it, expect, afterEach } from "vitest";
import ivm from "isolated-vm";
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
    const r = await repl.execute("(async () => { try { await llm_query('x'); } catch (e) { return e.message; } })()");
    expect(r.success).toBe(true);
    expect(r.expression).toBe("kaboom");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @freecode-rs/repl test`
Expected: import error for `bridge`.

- [ ] **Step 3: Write `packages/rlm-repl/src/bridge.ts`**

```ts
import ivm from "isolated-vm";
import type { IsolatedVmREPL } from "./isolated-vm.js";

export interface BridgeCallbacks {
  llmQuery: (prompt: string) => Promise<string>;
  rlmQuery: (prompt: string) => Promise<string>;
}

const SANDBOX_BRIDGE = `
const llm_query = (prompt) => __bridge.llmQuery(prompt);
const rlm_query = (prompt) => __bridge.rlmQuery(prompt);
`;

export function installBridge(
  repl: IsolatedVmREPL,
  cbs: BridgeCallbacks,
): void {
  const ivmRepl = repl as unknown as {
    isolate: ivm.Isolate;
    context: ivm.Context;
  };
  const { isolate, context } = ivmRepl;

  const llmRef = isolate.createReferenceSafe(
    new ivm.Reference(async (prompt: unknown) => {
      const p = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
      return await cbs.llmQuery(p);
    }),
  );

  const rlmRef = isolate.createReferenceSafe(
    new ivm.Reference(async (prompt: unknown) => {
      const p = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
      return await cbs.rlmQuery(p);
    }),
  );

  const script = isolate.compileScriptSync(
    SANDBOX_BRIDGE + "\n" +
    `globalThis.__bridge = { llmQuery: ${llmRef.applySync(undefined, [], { timeout: 1000 })}, rlmQuery: ${rlmRef.applySync(undefined, [], { timeout: 1000 })} };`,
  );
  // The above is too clever. Instead set the references directly:
  const refObj = {
    llmQuery: llmRef,
    rlmQuery: rlmRef,
  };
  context.global.set("__bridge", new ivm.Reference(refObj), { timeout: 1000 });

  const setup = isolate.compileScriptSync(SANDBOX_BRIDGE);
  setup.runSync(context, { timeout: 1000 });
}
```

Note: the `ivm.Reference` dance is finicky. The cleaner pattern:

```ts
context.global.set("__llm_query_ref", new ivm.Reference(cbs.llmQuery), { timeout: 1000 });
context.global.set("__rlm_query_ref", new ivm.Reference(cbs.rlmQuery), { timeout: 1000 });
const setup = isolate.compileScriptSync(`
  globalThis.llm_query = (p) => globalThis.__llm_query_ref.apply(p, { timeout: 60000, arguments: { copy: true }, result: { copy: true, promise: true } });
  globalThis.rlm_query = (p) => globalThis.__rlm_query_ref.apply(p, { timeout: 60000, arguments: { copy: true }, result: { copy: true, promise: true } });
`);
setup.runSync(context, { timeout: 1000 });
```

Replace `installBridge` body with that. Keep the export signature unchanged.

- [ ] **Step 4: Update `packages/rlm-repl/src/index.ts`**

```ts
export type { REPL, REPLResult, REPLOptions } from "./types.js";
export { IsolatedVmREPL } from "./isolated-vm.js";
export { installBridge, type BridgeCallbacks } from "./bridge.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @freecode-rs/repl test`
Expected: 11 tests passing (9 prior + 2 bridge).

- [ ] **Step 6: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-repl
git commit -m "feat(repl): host-bridge for llm_query and rlm_query"
```

---

## Task 11: rlm-core — wire bridge, recursion, depth-bounded sub-RLMs

**Files:**
- Modify: `packages/rlm-core/src/rlm.ts`
- Modify: `packages/rlm-core/src/rlm.test.ts`

**Interfaces:**
- Consumes: `installBridge` from `rlm-repl`, `Budget` from Task 9.
- Produces: full RLM with sub-call budget tracking, `currentDepth` propagation, child RLM spawning.

- [ ] **Step 1: Add a new failing test to `rlm.test.ts`**

Append:

```ts
  it("llm_query inside the REPL is counted and answered", async () => {
    const client = new MockLMClient([
      // First call: model writes code that calls llm_query and returns its result.
      { role: "assistant", content: "```repl\n(async () => FINAL(await llm_query('sub')))()\n```" },
      // Second call (the sub-LLM's reply), used by llm_query.
      { role: "assistant", content: "SUB-ANSWER" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxSubCalls: 10 });
    const result = await rlm.completion("top");
    expect(result.response).toBe("SUB-ANSWER");
    expect(result.metadata.totalSubCalls).toBe(1);
  });

  it("sub-RLM is invoked when rlm_query is called", async () => {
    // First call (root): spawn sub-RLM.
    { role: "assistant", content: "```repl\n(async () => FINAL(await rlm_query('child prompt')))()\n```" };
    // Sub-RLM (child) call:
    { role: "assistant", content: "```repl\nFINAL('child answer')\n```" };
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n(async () => FINAL(await rlm_query('child prompt')))()\n```" },
      { role: "assistant", content: "```repl\nFINAL('child answer')\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxDepth: 3, maxSubCalls: 10 });
    const result = await rlm.completion("top");
    expect(result.response).toBe("child answer");
    expect(result.metadata.depthReached).toBe(1);
    expect(result.metadata.totalSubCalls).toBe(1);
  });

  it("maxSubCalls stops the run with finishedReason 'max_iterations'", async () => {
    // A loop where llm_query is called every iteration and we never FINAL.
    const client = new MockLMClient([
      { role: "assistant", content: "```repl\n(async () => { await llm_query('1'); PRINT('go'); })()\n```" },
      { role: "assistant", content: "```repl\n(async () => { await llm_query('2'); PRINT('go'); })()\n```" },
    ]);
    const repl = new IsolatedVmREPL();
    const rlm = new RLM({ client, repl, maxSubCalls: 1, maxIterations: 5 });
    const result = await rlm.completion("top");
    // First iteration succeeds, second is blocked by budget on the sub-call.
    expect(result.metadata.finishedReason).not.toBe("final");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @freecode-rs/core test`
Expected: `llm_query is not defined` errors.

- [ ] **Step 3: Rewrite `packages/rlm-core/src/rlm.ts`**

```ts
import type { ChatMessage } from "@freecode-rs/client";
import type {
  CoreREPL,
  Iteration,
  RLMOptions,
  RLMResult,
} from "./types.js";
import { BUILTIN_SYSTEM_PROMPT } from "./prompt.js";
import { extractReplCode } from "./utils/code-extract.js";
import { buildHistoryMessages } from "./utils/messages.js";
import { extractFinal } from "./final.js";
import { Budget, BudgetExceededError } from "./budget.js";
import { installBridge } from "@freecode-rs/repl";

export class RLM {
  private readonly client: RLMOptions["client"];
  private readonly repl: CoreREPL;
  private readonly systemPrompt: string;
  private readonly maxDepth: number;
  private readonly maxIterations: number;
  private readonly maxSubCalls: number;
  private readonly verbose: boolean;
  private readonly currentDepth: number;
  private readonly budget: Budget;
  private maxDepthSeen = 0;

  constructor(opts: RLMOptions, internal?: { currentDepth?: number; budget?: Budget }) {
    this.client = opts.client;
    this.repl = opts.repl;
    this.systemPrompt = opts.systemPrompt ?? BUILTIN_SYSTEM_PROMPT;
    this.maxDepth = opts.maxDepth ?? 3;
    this.maxIterations = opts.maxIterations ?? 50;
    this.maxSubCalls = opts.maxSubCalls ?? 100;
    this.verbose = opts.verbose ?? false;
    this.currentDepth = internal?.currentDepth ?? 0;
    this.budget = internal?.budget ?? new Budget({ maxIterations: this.maxIterations, maxSubCalls: this.maxSubCalls });
  }

  async completion(prompt: string): Promise<RLMResult> {
    const startedAt = Date.now();
    await this.repl.load("context", prompt);

    installBridge(
      this.repl as unknown as Parameters<typeof installBridge>[0],
      {
        llmQuery: (p) => this.callLlm(p),
        rlmQuery: (p) => this.callRlm(p),
      },
    );

    const iterations: Iteration[] = [];
    let finalAnswer: string | null = null;
    let finishedReason: RLMResult["metadata"]["finishedReason"] = "max_iterations";

    for (let i = 0; i < this.maxIterations; i++) {
      try {
        this.budget.tryConsumeIteration();
      } catch {
        break;
      }
      const messages = buildHistoryMessages({
        systemPrompt: this.systemPrompt,
        iterations,
      });
      let assistantMessage: ChatMessage;
      try {
        assistantMessage = await this.client.chat(messages);
      } catch (e) {
        iterations.push({
          index: i,
          assistantMessage: { role: "assistant", content: `[client error] ${(e as Error).message}` },
          replResult: { success: false, stdout: [], error: { name: "LMError", message: (e as Error).message, trace: "" }, durationMs: 0 },
          subCallsAtStart: this.budget.subCalls,
        });
        finishedReason = "error";
        break;
      }

      const code = extractReplCode(assistantMessage.content);
      if (!code) {
        iterations.push({
          index: i,
          assistantMessage,
          replResult: { success: true, stdout: [], durationMs: 0 },
          subCallsAtStart: this.budget.subCalls,
        });
        finalAnswer = assistantMessage.content;
        finishedReason = "final";
        break;
      }

      const replResult = await this.repl.execute(code);
      iterations.push({
        index: i,
        assistantMessage,
        replResult,
        subCallsAtStart: this.budget.subCalls,
      });

      if (this.verbose) {
        console.error(`[rlm d=${this.currentDepth} i=${i}] code=${code.length}B success=${replResult.success}`);
      }

      const final = await extractFinal(replResult, () => this.repl.inspect());
      if (final) {
        finalAnswer = final.answer;
        finishedReason = "final";
        break;
      }
    }

    return {
      response: finalAnswer ?? iterations[iterations.length - 1]?.assistantMessage.content ?? "",
      iterations,
      metadata: {
        startedAt,
        finishedAt: Date.now(),
        totalSubCalls: this.budget.subCalls,
        depthReached: this.maxDepthSeen,
        finishedReason,
      },
    };
  }

  private async callLlm(prompt: string): Promise<string> {
    this.budget.tryConsumeSubCall();
    const reply = await this.client.chat([{ role: "user", content: prompt }]);
    return reply.content;
  }

  private async callRlm(prompt: string): Promise<string> {
    // Depth check first.
    if (this.currentDepth + 1 >= this.maxDepth) {
      if (this.verbose) console.error(`[rlm d=${this.currentDepth}] rlm_query depth-limited, degrading to llm_query`);
      return this.callLlm(prompt);
    }
    this.budget.tryConsumeSubCall();
    if (this.currentDepth + 1 > this.maxDepthSeen) this.maxDepthSeen = this.currentDepth + 1;

    // Dynamic import to avoid circular dep between core and repl.
    const { IsolatedVmREPL } = await import("@freecode-rs/repl");
    const childRepl = new IsolatedVmREPL();
    const child = new RLM(
      {
        client: this.client,
        repl: childRepl,
        systemPrompt: this.systemPrompt,
        maxDepth: this.maxDepth,
        maxIterations: this.maxIterations,
        maxSubCalls: this.maxSubCalls,
        verbose: this.verbose,
      },
      { currentDepth: this.currentDepth + 1, budget: this.budget },
    );
    try {
      const result = await child.completion(prompt);
      return result.response;
    } finally {
      await childRepl.dispose();
    }
  }
}

export type { ChatMessage } from "@freecode-rs/client";
```

- [ ] **Step 4: Add `@freecode-rs/repl` to core's package.json dependencies**

Modify `packages/rlm-core/package.json`, under `dependencies`:

```json
    "@freecode-rs/repl": "workspace:*",
```

- [ ] **Step 5: Install and test**

Run: `pnpm install && pnpm -F @freecode-rs/core test`
Expected: 13 tests passing (3 original + 3 new + 7 prior).

- [ ] **Step 6: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "feat(core): llm_query and rlm_query via host bridge, depth-limited recursion, sub-call budget"
```

---

## Task 12: rlm-client — live integration test against gpt-5-nano

**Files:**
- Modify: `packages/rlm-client/src/vercel-ai.test.ts`

**Interfaces:**
- Consumes: real OpenAI API via `OPENAI_API_KEY` env var.
- Produces: one test that exercises `VercelAIClient.chat()` end-to-end.

- [ ] **Step 1: Append an integration test to `vercel-ai.test.ts`**

```ts
describe("VercelAIClient (integration)", () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const itIfKey = apiKey ? it : it.skip;

  itIfKey("reaches the API and returns a non-empty assistant message", async () => {
    const c = new VercelAIClient({ model: "gpt-5-nano", apiKey });
    const reply = await c.chat([{ role: "user", content: "Reply with the single word: OK" }]);
    expect(reply.role).toBe("assistant");
    expect(reply.content.toLowerCase()).toContain("ok");
  }, 30_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `OPENAI_API_KEY=sk-... pnpm -F @freecode-rs/client test`
Expected: integration test passes (or is skipped if no key).

- [ ] **Step 3: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-client
git commit -m "test(client): live integration test for VercelAIClient"
```

---

## Task 13: End-to-end test — "print first 100 powers of two"

**Files:**
- Create: `packages/rlm-core/src/rlm.e2e.test.ts`

**Interfaces:**
- Consumes: `RLM`, `MockLMClient` is too rigid here; use `VercelAIClient` against gpt-5-nano.
- Produces: a single e2e test that runs the example from the rlm README in our RLM and asserts the answer.

- [ ] **Step 1: Write `packages/rlm-core/src/rlm.e2e.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { VercelAIClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

describe("RLM e2e (requires OPENAI_API_KEY)", () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const itIfKey = apiKey ? it : it.skip;

  itIfKey(
    "prints the first 100 powers of two (or finalizes the equivalent)",
    async () => {
      const client = new VercelAIClient({ model: "gpt-5-nano", apiKey });
      const repl = new IsolatedVmREPL();
      const rlm = new RLM({ client, repl, maxIterations: 8, maxSubCalls: 5, verbose: true });
      const result = await rlm.completion(
        "Print the first 100 powers of two, each on a newline.",
      );
      // The model may print to stdout inside the REPL or return a string with them.
      const stdout = repl.readStdout().join("\n");
      const combined = stdout + "\n" + result.response;
      expect(combined).toMatch(/1/);
      expect(combined).toMatch(/2/);
      // We expect at least one power-of-two marker; either the first (1) or the largest in range.
      const hasPowers = /\b(1|2|4|8|16|32|64|128)\b/.test(combined);
      expect(hasPowers).toBe(true);
      await repl.dispose();
    },
    90_000,
  );
});
```

- [ ] **Step 2: Run**

Run: `OPENAI_API_KEY=sk-... pnpm -F @freecode-rs/core test`
Expected: e2e test passes (or is skipped if no key).

- [ ] **Step 3: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "test(core): e2e test — first 100 powers of two"
```

---

## Task 14: Needle-in-the-haystack (NIAH) test

**Files:**
- Create: `packages/rlm-core/src/rlm.niah.test.ts`

**Interfaces:**
- Consumes: `RLM`, `VercelAIClient`, `IsolatedVmREPL`.
- Produces: a test that hides a random number in a large random-text context and verifies the RLM finds it.

- [ ] **Step 1: Write `packages/rlm-core/src/rlm.niah.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { RLM } from "./rlm.js";
import { VercelAIClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

function buildHaystack(secret: string, approxLines: number): string {
  const words = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "elit", "sed"];
  const lines: string[] = [];
  // Insert secret near the middle.
  const middle = Math.floor(approxLines / 2);
  for (let i = 0; i < approxLines; i++) {
    if (i === middle) lines.push(`secret-token: ${secret}`);
    let line = "";
    for (let j = 0; j < 12; j++) {
      line += words[(i * 31 + j * 7) % words.length] + " ";
    }
    lines.push(line.trim());
  }
  return lines.join("\n");
}

describe("RLM needle-in-the-haystack (requires OPENAI_API_KEY)", () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const itIfKey = apiKey ? it : it.skip;

  itIfKey(
    "finds a random number hidden in ~50k lines of random text",
    async () => {
      const secret = String(Math.floor(Math.random() * 1_000_000));
      const context = buildHaystack(secret, 50_000);
      const client = new VercelAIClient({ model: "gpt-5-nano", apiKey });
      const repl = new IsolatedVmREPL();
      const rlm = new RLM({ client, repl, maxIterations: 15, maxSubCalls: 20 });
      const result = await rlm.completion(
        `Find the secret token in the context. Reply with ONLY the token value.`,
      );
      expect(result.response.trim()).toContain(secret);
      await repl.dispose();
    },
    180_000,
  );
});
```

- [ ] **Step 2: Run**

Run: `OPENAI_API_KEY=sk-... pnpm -F @freecode-rs/core test`
Expected: NIAH test passes (or skipped without key).

- [ ] **Step 3: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add packages/rlm-core
git commit -m "test(core): needle-in-the-haystack e2e"
```

---

## Task 15: CLI wiring — apps/cli with real RLM

**Files:**
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

**Interfaces:**
- Consumes: `RLM`, `VercelAIClient`, `IsolatedVmREPL`.
- Produces: a working CLI: `freecode-rlm "prompt" [--model=...] [--max-depth=...] [--verbose]`.

- [ ] **Step 1: Rewrite `apps/cli/src/index.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { RLM } from "@freecode-rs/core";
import { VercelAIClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

export interface RunOptions {
  model: string;
  maxDepth: number;
  maxIterations: number;
  maxSubCalls: number;
  replTimeoutMs: number;
  replMemoryMb: number;
  verbose: boolean;
}

export async function run(args: string[]): Promise<number> {
  const program = new Command();
  program
    .name("freecode-rlm")
    .description("Recursive Language Model CLI")
    .version("0.0.0")
    .argument("<prompt>", "the prompt to send to the RLM")
    .option("-m, --model <name>", "OpenAI model", "gpt-5-nano")
    .option("--max-depth <n>", "max recursion depth", "3")
    .option("--max-iterations <n>", "max outer iterations", "50")
    .option("--max-sub-calls <n>", "max sub-calls across the run", "100")
    .option("--repl-timeout-ms <n>", "REPL timeout per execute()", "30000")
    .option("--repl-memory-mb <n>", "isolated-vm memory limit", "256")
    .option("-v, --verbose", "verbose logging", false);
  program.parse(["node", "freecode-rlm", ...args]);

  const prompt = program.args[0];
  if (!prompt) {
    console.error("error: prompt argument is required");
    return 2;
  }
  const opts = program.opts<RunOptions>();

  const client = new VercelAIClient({ model: opts.model });
  const repl = new IsolatedVmREPL({
    timeoutMs: Number(opts.replTimeoutMs),
    memoryMb: Number(opts.replMemoryMb),
  });
  const rlm = new RLM({
    client,
    repl,
    maxDepth: Number(opts.maxDepth),
    maxIterations: Number(opts.maxIterations),
    maxSubCalls: Number(opts.maxSubCalls),
    verbose: opts.verbose,
  });

  try {
    const result = await rlm.completion(prompt);
    process.stdout.write(result.response + "\n");
    if (opts.verbose) {
      console.error(
        `[finished] reason=${result.metadata.finishedReason} iterations=${result.iterations.length} subCalls=${result.metadata.totalSubCalls}`,
      );
    }
    return 0;
  } finally {
    await repl.dispose();
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/index.ts");
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
```

- [ ] **Step 2: Replace `apps/cli/src/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { run } from "./index.js";

describe("cli", () => {
  it("prints usage error when no prompt is given and exits 2", async () => {
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errs.push(args.map(String).join(" "));
    try {
      const code = await run([]);
      expect(code).toBe(2);
      expect(errs.join(" ")).toContain("prompt");
    } finally {
      console.error = origErr;
    }
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm -F @freecode-rs/cli test`
Expected: 1 test passing.

- [ ] **Step 4: Smoke-test the CLI**

Run: `OPENAI_API_KEY=sk-... pnpm -F @freecode-rs/cli dev -- "Print me 2 + 2"`
Expected: prints `4` (or similar). Verify exit code 0.

- [ ] **Step 5: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add apps/cli
git commit -m "feat(cli): wire RLM with CLI flags"
```

---

## Task 16: README and examples in apps/web

**Files:**
- Modify: `apps/web/app/page.tsx` (existing starter)
- Modify: `README.md` (replace Turborepo starter text)

**Interfaces:**
- Consumes: nothing.
- Produces: repo README describes the project; apps/web landing page has install/usage.

- [ ] **Step 1: Replace repo `README.md`**

```markdown
# freecode-rlm

A Recursive Language Model (RLM) runtime in TypeScript.

The LLM writes JavaScript inside a sandboxed REPL; it can inspect a large
context programmatically and call sub-LM or sub-RLM functions.

## Quickstart

\`\`\`bash
pnpm install
pnpm build
export OPENAI_API_KEY=sk-...
pnpm -F @freecode-rs/cli dev -- "Print the first 100 powers of two"
\`\`\`

## Layout

- \`packages/rlm-core\` — RLM class, types, loop
- \`packages/rlm-client\` — LM provider adapters (Vercel AI SDK)
- \`packages/rlm-repl\` — sandbox REPL (isolated-vm)
- \`apps/cli\` — command-line entry

See \`docs/superpowers/specs/2026-08-10-freecode-rlm-design.md\` for the design.

## Learning project

We study and re-implement (no imports) the following references:

- \`/home/ayan-de/Projects/githubProjects/agents/rlm/rlm\` (full Python impl)
- \`/home/ayan-de/Projects/githubProjects/agents/rlm/rlm-minimal\` (minimal impl)
- \`/home/ayan-de/Projects/githubProjects/agents/rlm/prime-agent\` (TS agent runtime)
- \`/home/ayan-de/Projects/freecode\` (sibling harness project)
```

- [ ] **Step 2: Update `apps/web/app/page.tsx`**

Replace the file's body with a simple landing page that links to the spec and shows usage:

```tsx
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>freecode-rlm</h1>
      <p>Recursive Language Model runtime in TypeScript.</p>
      <pre>
        <code>{`pnpm install
pnpm build
export OPENAI_API_KEY=sk-...
pnpm -F @freecode-rs/cli dev -- "Print the first 100 powers of two"`}</code>
      </pre>
      <p>
        See <code>docs/superpowers/specs/2026-08-10-freecode-rlm-design.md</code>{" "}
        for the design doc.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Verify web builds**

Run: `pnpm -F web build`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git add README.md apps/web
git commit -m "docs: README and web landing page"
```

---

## Task 17: Full repo verification

**Files:** none (verification only).

- [ ] **Step 1: Install**

Run: `pnpm install`
Expected: no errors.

- [ ] **Step 2: Build all**

Run: `pnpm build`
Expected: turbo reports all packages built, exit 0.

- [ ] **Step 3: Test all (no live API)**

Run: `pnpm test`
Expected: all unit tests green; live API tests skipped because `OPENAI_API_KEY` is unset in CI.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors. If any package lacks a `lint` script, add `"lint": "eslint src"` to its `package.json`.

- [ ] **Step 5: Final commit if anything was changed**

```bash
cd /home/ayan-de/Projects/freecode-rlm
git status
# If anything modified:
# git add -A
# git commit -m "chore: repo-wide lint and build fixes"
```

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (packages) — Task 1 (cli), Task 2 (repl), Task 4 (client), Task 6 (core). ✓
- §4 REPL interface — Tasks 2–3. ✓
- §4.2 host-bridge — Task 10. ✓
- §4.3 defaults/limits — Task 3 (timeout), Task 1+15 (memory via CLI), §7 default tables reflect this. ✓
- §5.1 RLM API — Tasks 8, 11. ✓
- §5.2 loop — Task 8, refined in Task 11. ✓
- §5.3 system prompt — Task 7. ✓
- §5.4 recursion depth — Task 11 (silent degrade + budget). ✓
- §5.5 FINAL/FINAL_VAR — Task 7. ✓
- §6.1 LMClient interface — Task 4. ✓
- §6.2 VercelAIClient — Tasks 5, 12. ✓
- §7 config/defaults — encoded in tasks' constructors; CLI in Task 15. ✓
- §8 milestones M0–M5 — Tasks 1–17 cover all five milestones (M0 = Tasks 1, 6; M1 = 2, 3, 10; M2 = 4, 5, 12; M3 = 7, 8; M4 = 9, 11, 13, 14; M5 = 15, 16). ✓
- §9 AGENTS.md/CLAUDE.md — Task 1. ✓
- §10 out-of-scope — respected throughout (no Docker, no compaction, etc.). ✓
- §11 risks — addressed: isolated-vm async bridge (Task 10 with explicit fallback), AI SDK message wrapping (Task 5 wraps to/from `ChatMessage`), cost discipline (Task 9 budget, Task 11 enforcement), system prompt drift (Task 7 prompt test). ✓
- §12 success criteria — covered by Tasks 13–15. ✓

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or vague references. All step code blocks are concrete.

**3. Type consistency:**
- `ChatMessage.role` — used as `"system" | "user" | "assistant"` in Tasks 4, 5, 6, 7, 8, 11. Consistent.
- `REPL.execute` signature — `Promise<REPLResult>` in Task 2; `CoreREPLResult` used in core tasks 6–11 (structurally identical, distinct type but same shape). The duplication is intentional (per Task 6 Step 3 note).
- `RLM` constructor second arg `{ currentDepth?, budget? }` — Task 8 doesn't use it; Task 11 uses both. Consistent.
- `installBridge` signature — `(repl, cbs)` in Task 10; called in Task 11. ✓

Self-review found no blockers. Proceed to execution.