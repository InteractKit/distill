# CLI reference

```
distill <command> [options]
```

All commands accept `--task <path>` to point at a config file. When omitted, the
config is [auto-discovered](configuration.md) in the current directory.

| Command | Needs API key? |
|---|---|
| [`distill init`](#distill-init) | no |
| [`distill build`](#distill-build) | **yes** |
| [`distill label`](#distill-label) | **yes** |
| [`distill run`](#distill-run) | **no** |
| [`distill host`](#distill-host) | only with `--learn` |

---

## `distill init`

Scaffold a new, runnable project and install its dependencies.

```bash
distill init <dir>
```

| Argument / Option | Description |
|---|---|
| `<dir>` | **Required.** Project directory to create. |
| `--force` | Overwrite existing files. By default, existing files are skipped. |
| `--no-install` | Skip running `npm install` after scaffolding. |
| `--no-agent` | Skip the `AGENTS.md` guide for AI coding tools. |

Creates a complete project:

```
package.json        deps (@interactkit/distill) + scripts
tsconfig.json       so the typed config resolves
distill.config.ts   the fields to extract + models
data.jsonl          sample inputs
.env.example        API-key template
.gitignore          ignores cache + generated artifacts
AGENTS.md           guidance for AI coding agents (skip with --no-agent)
README.md           the commands
```

Then runs `npm install` so `@interactkit/distill` resolves immediately (skip with
`--no-install`).

---

## `distill build`

The full pipeline: label your data (cached), then synthesize the extractor code.

```bash
distill build [--task <path>] [--relabel]
```

| Option | Description |
|---|---|
| `--task <path>` | Config file (default: auto-discover). |
| `--relabel` | Clear the cache and re-label from scratch (e.g. after changing the label model or data). |

What it does:

1. Labels every input in `data.jsonl` into `cache.jsonl` (skips already-labeled rows).
2. Sets aside some examples to test against (so it can tell real accuracy from memorization).
3. Generates an extractor, then improves it over `synth.rounds` rounds, keeping the
   best version it finds.
4. Writes the result to `output` (default `extractor.gen.ts`) and prints an accuracy
   score (F1, 0–1) on examples it didn't train on.

Requires an API key for both the label and synth providers. See [Providers](providers.md).
For the full picture, see [How it works](how-it-works.md).

---

## `distill label`

Stage 1 only - label your data without synthesizing code. Useful to build or
refresh the cache separately.

```bash
distill label [--task <path>] [--relabel]
```

| Option | Description |
|---|---|
| `--task <path>` | Config file (default: auto-discover). |
| `--relabel` | Clear the cache and re-label from scratch. |

Produces `cache.jsonl`. Resumable: re-running only labels new/uncached inputs.

---

## `distill run`

Apply the **built** extractor to new text. Pure code - no LLM, no API key, instant.

```bash
distill run [--task <path>] [--in <file>] [--out <file>]
```

| Option | Description |
|---|---|
| `--task <path>` | Config file (default: auto-discover). |
| `-i, --in <file>` | Input file (`.jsonl` or `.txt`). Defaults to **stdin**. |
| `-o, --out <file>` | Output JSONL file. Defaults to **stdout**. |

Examples:

```bash
distill run --in new.jsonl --out results.jsonl
cat new.txt | distill run > results.jsonl
```

Requires a prior `distill build` (it loads `output`). The built extractor is
self-contained - it bundles its own knowledge, so `run` needs no `cache.jsonl`
and no `@interactkit/distill` at runtime. See
[Input & output](input-output.md) for formats.

---

## `distill host`

Serve extraction over HTTP. Default = the built code (no LLM). `--learn` = serve
LLM answers and improve the extractor from live traffic.

```bash
distill host [--task <path>] [--learn] [--port <port>]
```

| Option | Description |
|---|---|
| `--task <path>` | Config file (default: auto-discover). |
| `--learn` | Always call the LLM, capture results, and rebuild the extractor over time. |
| `-p, --port <port>` | HTTP port (default from config, else `3000`). |

Endpoints: `POST /extract`, `GET /metrics` (Prometheus; `?format=json` for JSON),
`GET /health`. Serve mode needs no API key; `--learn` does.

See **[Hosting](hosting.md)** for the full guide - learn-mode workflow, the
agreement metric, and rebuild settings.

---

## Global

| Option | Description |
|---|---|
| `-h, --help` | Help for a command (e.g. `distill build --help`). |
| `-V, --version` | Print the version. |
