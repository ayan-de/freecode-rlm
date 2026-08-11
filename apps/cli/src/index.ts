#!/usr/bin/env node
import { Command } from "commander";
import { RLM } from "@freecode-rs/core";
import { VercelAIClient } from "@freecode-rs/client";
import { IsolatedVmREPL } from "@freecode-rs/repl";

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
    .argument("<prompt>", "the prompt to send to the RLM")
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
    .option("-v, --verbose", "verbose logging", false);

  let prompt: string;
  let opts: RunOptions;
  try {
    program.parse(["node", "freecode-rlm", ...args]);
    const got = program.args[0];
    if (!got) {
      // Defensive: commander's required-argument check fires inside
      // program.parse() first, so this branch is unreachable in practice.
      process.stderr.write("error: prompt argument is required\n");
      return 2;
    }
    prompt = got;
    opts = program.opts<RunOptions>();
  } catch {
    // CommanderError from exitOverride (missing argument, bad flag, etc).
    // Commander already wrote the message into stderrChunks via our
    // configureOutput writeErr override; flush it to real stderr so the
    // user actually sees the error.
    for (const chunk of stderrChunks) process.stderr.write(chunk);
    return 2;
  }

  const apiKey = opts.apiKey ?? process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.error(
      "error: API key not set. Pass --api-key or set MINIMAX_API_KEY.",
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
