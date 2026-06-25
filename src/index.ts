#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { InitCommand } from "./cli/commands/InitCommand.js";
import { BuildCommand } from "./cli/commands/BuildCommand.js";
import { LabelCommand } from "./cli/commands/LabelCommand.js";
import { RunCommand } from "./cli/commands/RunCommand.js";
import { HostCommand } from "./cli/commands/HostCommand.js";

// ─── distill - build & run synthesized entity extractors ─────────────────────
// Config lives in distill.config.ts (typed, via defineConfig) or task.json.
// When --task is omitted, it's auto-discovered in cwd.
//
//   distill init   [dir]                          scaffold a starter project
//   distill build  [--task f] [--relabel]         label → synth → write extractor
//   distill label  [--task f] [--relabel]         data.txt → cache.jsonl only
//   distill run    [--task f] [--in f] [--out f]  apply built extractor (file/stdin)

const program = new Command();

program
  .name("distill")
  .description(
    "Build and run LLM-synthesized entity extractors (label → learn → code).",
  )
  .version("1.0.0");

// No default → Config.load() auto-discovers distill.config.ts / task.json in cwd.
const taskOpt = [
  "-t, --task <path>",
  "path to config (distill.config.ts or task.json)",
] as const;

program
  .command("init")
  .description("Scaffold a runnable starter project (package.json, config, data, env) and install deps.")
  .argument("<dir>", "project directory to create")
  .option("--force", "overwrite existing files")
  .option("--no-install", "skip running npm install")
  .option("--no-agent", "skip the AGENTS.md guide for AI coding tools")
  .action((dir, opts) => new InitCommand({ dir, ...opts }).run());

program
  .command("build")
  .description(
    "Label data (cached), run the synth loop, and write the extractor code.",
  )
  .option(...taskOpt)
  .option("--relabel", "clear the cache and re-label from scratch")
  .option(
    "--fresh",
    "ignore the existing extractor and synthesize from scratch (default: warm-start from it)",
  )
  .action((opts) => new BuildCommand(opts).run());

program
  .command("label")
  .description("Stage 1 only: label data.txt into cache.jsonl (resumable).")
  .option(...taskOpt)
  .option("--relabel", "clear the cache and re-label from scratch")
  .action((opts) => new LabelCommand(opts).run());

program
  .command("run")
  .description(
    "Apply the built extractor to new input (no LLM). Reads --in or stdin; writes --out or stdout.",
  )
  .option(...taskOpt)
  .option(
    "-i, --in <path>",
    "input file (one text per line); defaults to stdin",
  )
  .option("-o, --out <path>", "output JSONL file; defaults to stdout")
  .action((opts) => new RunCommand(opts).run());

program
  .command("host")
  .description(
    "Serve extraction over HTTP. Default = built code (no LLM). --learn = serve LLM answers and learn from them.",
  )
  .option(...taskOpt)
  .option("--learn", "always call the LLM, capture results, and rebuild the extractor over time")
  .option("-p, --port <port>", "HTTP port (default from config, else 3000)")
  .action((opts) => new HostCommand(opts).run());

program.parseAsync().catch((err) => {
  process.stderr.write(
    "\n\x1b[31m✘ " +
      (err instanceof Error ? err.message : String(err)) +
      "\x1b[0m\n",
  );
  process.exit(1);
});
