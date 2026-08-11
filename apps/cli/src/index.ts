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
