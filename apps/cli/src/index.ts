#!/usr/bin/env node
import { Command } from "commander";
import { RLM, type RLMResult } from "@freecode-rs/core";
import { VercelAIClient, type LMClient, type ChatMessage } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";
import * as readline from "node:readline/promises";

// Fallback API key source shared with the sibling `freecode` project's config.
async function readFreecodeApiKey(): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const raw = await fs.readFile(
      path.join(os.homedir(), ".freecode", "config.json"),
      "utf8",
    );
    const config = JSON.parse(raw) as {
      providers?: Record<string, { apiKey?: string }>;
    };
    return config.providers?.minimax?.apiKey;
  } catch {
    return undefined;
  }
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// Minimal trace of what the RLM did, printed after each turn.
// ponytail: no live streaming (RLM.completion only resolves iterations at
// the end) — add a per-iteration callback in rlm-core if live output is needed.
function printTrace(result: RLMResult): void {
  for (const it of result.iterations) {
    const code = it.replResult.stdout.length
      ? it.replResult.stdout.join("\n")
      : undefined;
    process.stdout.write(dim(`  [${it.index}] `));
    if (code) process.stdout.write(dim(`repl -> ${truncate(code)}\n`));
    else process.stdout.write(dim("(no repl output)\n"));
  }
  process.stdout.write(
    dim(
      `  done: ${result.metadata.finishedReason}, ${result.iterations.length} iteration(s), ${result.metadata.totalSubCalls} sub-call(s)\n`,
    ),
  );
}

function truncate(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function runInteractive(
  client: LMClient,
  opts: RunOptions,
): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(
    cyan("freecode-rlm") +
      dim(" — interactive mode (Ctrl+D to exit, /reset to clear conversation)\n"),
  );

  // One REPL + one running message history for the whole session, so state
  // (files written, variables defined) and conversation memory both persist
  // across turns instead of resetting on every line (see AGENTS.md history).
  let repl = new IsolatedVmREPL({
    timeoutMs: Number(opts.replTimeoutMs),
    memoryMb: Number(opts.replMemoryMb),
  });
  let history: ChatMessage[] = [];

  try {
    for (;;) {
      const line = await rl.question(green("> "));
      if (!line.trim()) continue;
      if (line.trim() === "/reset") {
        await repl.dispose();
        repl = new IsolatedVmREPL({
          timeoutMs: Number(opts.replTimeoutMs),
          memoryMb: Number(opts.replMemoryMb),
        });
        history = [];
        process.stdout.write(dim("conversation and REPL state cleared\n"));
        continue;
      }
      const rlm = new RLM({
        client,
        repl,
        maxDepth: Number(opts.maxDepth),
        maxIterations: Number(opts.maxIterations),
        maxSubCalls: Number(opts.maxSubCalls),
        verbose: opts.verbose,
        enableSystemTools: opts.enableSystemTools,
      });
      try {
        const result = await rlm.completion(line, { history });
        history = result.messages;
        if (opts.verbose) printTrace(result);
        process.stdout.write(yellow(result.response) + "\n");
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`);
      }
    }
  } catch {
    // rl.question rejects on Ctrl+D (stream close) — treat as clean exit.
  } finally {
    rl.close();
    await repl.dispose();
  }
  process.stdout.write("\n");
  return 0;
}

export interface RunOptions {
  model: string;
  // Plan-deviation: commander normalises `--base-url` to camelCase
  // `baseUrl`. Match the runtime field name in the type so callers don't
  // read undefined.
  baseUrl: string;
  apiKey?: string;
  context?: string;
  maxDepth: number;
  maxIterations: number;
  maxSubCalls: number;
  replTimeoutMs: number;
  replMemoryMb: number;
  verbose: boolean;
  enableSystemTools: boolean;
}

export async function run(args: string[]): Promise<number> {
  const program = new Command();
  // Capture commander's stderr writes so we own the error output and can
  // return a non-zero exit code without double-printing.
  const stderrChunks: string[] = [];
  program
    // Plan-deviation: commander normally calls process.exit on argument /
    // option errors. exitOverride() makes it throw a CommanderError instead,
    // which lets us return a non-zero code from `run()` and unit-test the
    // path that fires when no prompt is given.
    .exitOverride()
    .configureOutput({
      writeErr: (str) => stderrChunks.push(str),
    })
    .name("freecode-rlm")
    .description("Recursive Language Model CLI")
    .version("0.0.0")
    .argument("[prompt]", "the prompt to send to the RLM (omit for interactive mode)")
    // Plan-deviation: default model is MiniMax-M3 (project default) rather
    // than `gpt-5-nano`. The OpenAI-compatible baseURL and the API key (read
    // from MINIMAX_API_KEY if --api-key is not passed) target the MiniMax
    // endpoint. Same rationale as Tasks 12-14.
    .option("-m, --model <name>", "LM model", "MiniMax-M3")
    .option(
      "--base-url <url>",
      "OpenAI-compatible base URL",
      "https://api.minimax.io/v1",
    )
    .option("--api-key <key>", "API key (defaults to MINIMAX_API_KEY env)")
    .option(
      "--context <string>",
      "long context to pass to the model (e.g. a haystack). Read from @file path if the value starts with @.",
    )
    .option("--max-depth <n>", "max recursion depth", "3")
    .option("--max-iterations <n>", "max outer iterations", "50")
    .option("--max-sub-calls <n>", "max sub-calls across the run", "100")
    .option("--repl-timeout-ms <n>", "REPL timeout per execute()", "30000")
    .option("--repl-memory-mb <n>", "isolated-vm memory limit", "256")
    .option(
      "--enable-system-tools",
      "expose bash()/readFile()/writeFile() to the REPL (host shell + filesystem access)",
      true,
    )
    .option(
      "--no-enable-system-tools",
      "disable bash()/readFile()/writeFile() access",
    )
    .option("-v, --verbose", "verbose logging", false);

  let prompt: string | undefined;
  let opts: RunOptions;
  try {
    program.parse(["node", "freecode-rlm", ...args]);
    prompt = program.args[0];
    opts = program.opts<RunOptions>();
  } catch {
    // CommanderError from exitOverride (missing argument, bad flag, etc).
    // Commander already wrote the message into stderrChunks via our
    // configureOutput writeErr override; flush it to real stderr so the
    // user actually sees the error.
    for (const chunk of stderrChunks) process.stderr.write(chunk);
    return 2;
  }

  const apiKey =
    opts.apiKey ??
    process.env.MINIMAX_API_KEY ??
    (await readFreecodeApiKey());
  if (!apiKey) {
    console.error(
      "error: API key not set. Pass --api-key, set MINIMAX_API_KEY, or configure ~/.freecode/config.json.",
    );
    return 2;
  }

  // Resolve --context: if it starts with "@", read the rest as a file path.
  // Useful for NIAH-style queries where the haystack is too large to paste.
  let context: string | undefined;
  if (opts.context) {
    if (opts.context.startsWith("@")) {
      const fs = await import("node:fs/promises");
      try {
        context = await fs.readFile(opts.context.slice(1), "utf8");
      } catch (e) {
        console.error(
          `error: failed to read context file: ${(e as Error).message}`,
        );
        return 2;
      }
    } else {
      context = opts.context;
    }
  }

  const client = new VercelAIClient({
    model: opts.model,
    apiKey,
    baseURL: opts.baseUrl,
  });

  if (!prompt) {
    return runInteractive(client, opts);
  }

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
    enableSystemTools: opts.enableSystemTools,
  });

  try {
    const result = context
      ? await rlm.completion(prompt, { context })
      : await rlm.completion(prompt);
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
