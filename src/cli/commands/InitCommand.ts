import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { spawn } from "node:child_process";
import { Reporter } from "../../ui/Reporter.js";

// `distill init [dir]` - scaffold a runnable starter project (create-next-app
// style). Writes a full project (package.json + tsconfig so the typed config
// resolves), sample data, env template, gitignore, README - then installs deps.
export class InitCommand {
  constructor(
    private readonly opts: {
      dir: string;
      force?: boolean;
      install?: boolean;
      agent?: boolean;
    },
  ) {}

  async run(): Promise<void> {
    const r = new Reporter();
    const projectName = (this.opts.dir ?? "").trim();
    if (!projectName) {
      throw new Error(
        "a project directory name is required: `distill init <dir>`",
      );
    }
    const dir = resolve(projectName);
    await mkdir(dir, { recursive: true });

    r.banner("distill · init", dir);

    const files: Record<string, string> = {
      "package.json": packageJson(basename(dir)),
      "tsconfig.json": TSCONFIG,
      "distill.config.ts": CONFIG_TS,
      "data.jsonl": DATA_JSONL,
      ".env.example": ENV_EXAMPLE,
      ".gitignore": GITIGNORE,
      "README.md": README,
    };
    // Tool-neutral agent guide, on by default (skip with --no-agent).
    if (this.opts.agent !== false) files["AGENTS.md"] = AGENTS_MD;

    let written = 0;
    let skipped = 0;
    for (const [fileName, content] of Object.entries(files)) {
      const path = join(dir, fileName);
      if (!this.opts.force && (await this.exists(path))) {
        r.note(`skip ${fileName} (exists; use --force to overwrite)`);
        skipped++;
        continue;
      }
      await writeFile(path, content, "utf8");
      r.ok(`wrote ${fileName}`);
      written++;
    }

    r.plain("");
    r.info(
      `scaffolded ${written} file(s)${skipped ? `, skipped ${skipped}` : ""}`,
    );

    // Install dependencies so `@interactkit/distill` resolves (config + CLI).
    // Skippable with --no-install for offline / CI use.
    const install = this.opts.install !== false;
    if (install) {
      r.plain("");
      r.info("installing dependencies (npm install) …");
      const ok = await this.npmInstall(dir);
      if (ok) r.ok("dependencies installed");
      else r.warn("npm install failed - run it yourself in the project dir");
    }

    r.plain("");
    r.note("next steps:");
    r.note(`  cd ${basename(dir)}`);
    r.note("  cp .env.example .env      # add your OPENAI_API_KEY");
    if (!install) r.note("  npm install");
    r.note("  edit distill.config.ts (fields) and data.jsonl (your texts)");
    r.note("  npx distill build         # label → build → extractor.gen.ts");
    r.note("  npx distill run --in data.jsonl");
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  /** Run `npm install` in the project dir, streaming output. Resolves to success. */
  private npmInstall(cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const child = spawn(npm, ["install"], { cwd, stdio: "inherit" });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }
}

// ─── Template files ──────────────────────────────────────────────────────────
// Pinned to the version that scaffolded the project.
const DISTILL_VERSION = "2.0.0";

function packageJson(name: string): string {
  // A minimal, runnable project. distill is a dependency so the typed config
  // (`import ... from "@interactkit/distill"`) resolves in the editor and at run.
  const safe =
    name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase() || "distill-project";
  return (
    JSON.stringify(
      {
        name: safe,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          build: "distill build",
          run: "distill run --in data.jsonl",
        },
        dependencies: {
          "@interactkit/distill": `^${DISTILL_VERSION}`,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["distill.config.ts"]
}
`;

const CONFIG_TS = `import { defineConfig } from "@interactkit/distill";

// Typed config - you get autocomplete, hover docs, and compile errors here.
export default defineConfig({
  instruction: "Extract entities from this text.",

  // The closed set of tags to extract.
  tags: [
    { name: "PERSON", description: "A person's full name" },
    { name: "ORG", description: "A company or organization" },
    { name: "SKILL", description: "A technical skill or technology" },
  ],

  // Optional few-shot examples improve labeling on small models.
  examples: [
    {
      input: "Ada Lovelace works at Analytical Engines and knows Python.",
      entities: [
        { text: "Ada Lovelace", tag: "PERSON" },
        { text: "Analytical Engines", tag: "ORG" },
        { text: "Python", tag: "SKILL" },
      ],
    },
  ],

  io: {
    data: "data.jsonl", // raw inputs, one record per line
    cache: "cache.jsonl", // labeled corpus (auto-generated)
    output: "extractor.gen.ts", // the synthesized extractor (auto-generated)
  },

  // Stage 1: label data.jsonl with a light model.
  label: { provider: "openai", model: "gpt-4o-mini", concurrency: 8 },

  // Stage 2: synthesize the extractor code.
  synth: {
    provider: "openai",
    model: "gpt-5.4-mini",
    rounds: 6,
    // Population search. size: 1 = simple hill-climb; >1 evolves diverse
    // candidates and combines their per-tag strengths (4x the cost).
    population: { size: 1, diversity: "per-tag-niche" },
  },
});
`;

// One JSON record per line: {"text": "...", "id"?: "..."}. The optional id is
// carried through to \`run\` output so results map back to source rows.
const DATA_JSONL = `{"id": "r1", "text": "Ada Lovelace works at Analytical Engines and knows Python."}
{"id": "r2", "text": "Grace Hopper, a compiler pioneer at Remington Rand, was fluent in COBOL."}
{"id": "r3", "text": "Looking for a remote opportunity starting next quarter."}
`;

const ENV_EXAMPLE = `# Set the key(s) for the provider(s) your config uses.
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_GENERATIVE_AI_API_KEY=...
# Ollama (local) needs no key. Optionally: OLLAMA_HOST=http://localhost:11434/api
`;

const GITIGNORE = `node_modules/
.env
# Labeled corpus + synthesized artifacts (regenerated by \`distill build\`)
cache.jsonl
extractor.gen.ts
extractor.gen.meta.json
# Per-candidate scratch files written during \`distill build\`
.distills/
`;

const README = `# My distill project

An LLM writes a small entity-extractor program from your examples; then the
*code* does the extraction - fast, free, and deterministic (no LLM at runtime).

## Setup
\`\`\`bash
npm install                # if not already done by \`distill init\`
cp .env.example .env        # add your OPENAI_API_KEY
\`\`\`

## Commands
\`\`\`bash
npx distill build              # label data.jsonl -> build -> extractor.gen.ts
npx distill run --in data.jsonl  # run the extractor (no LLM); also reads stdin
npx distill label              # just the labeling step
\`\`\`

Edit **distill.config.ts** (the fields to extract) and **data.jsonl** (your
example texts). \`build\`/\`label\` need an API key; \`run\` does not - that's the point.
`;

// Tool-neutral guidance for AI coding agents (Claude Code, Cursor, etc.).
const AGENTS_MD = `# Working in this project (for AI agents)

This is a **distill** project: an LLM writes an entity-extractor program from
labeled examples, then that program does the extraction with no LLM at runtime.

## Golden rule

**Do NOT hand-edit generated files.** These are produced by \`distill build\` and
overwritten on every run:

- \`extractor.gen.ts\` - the synthesized extractor
- \`cache.jsonl\` - the labeled corpus

To change behavior, edit the **source** and rebuild:

- \`distill.config.ts\` - the fields (tags) to extract, models, and settings
- \`data.jsonl\` - the example texts the extractor learns from

Then run \`npx distill build\`.

## Mental model

| Stage | Command | Cost |
|---|---|---|
| Label + build the extractor | \`distill build\` | one-time, **calls an LLM** (needs an API key) |
| Run the extractor on new text | \`distill run\` | free, no LLM, deterministic |

## Common tasks

- **Add/change a field:** edit \`tags\` in \`distill.config.ts\`, then \`distill build\`.
- **Improve accuracy:** add more (or more varied) lines to \`data.jsonl\`, then rebuild.
- **A field has low recall:** it may be open-ended (names, novel titles). Consider
  \`synth.population.size > 1\` in the config, or accept that code can't fully match
  a live LLM on meaning-based fields.

## Don't

- Don't commit \`.env\`, \`cache.jsonl\`, or \`extractor.gen.ts\` (already gitignored).
- Don't edit the generated extractor to "quick-fix" a case - it won't survive the
  next build. Fix the config or data instead.
`;
