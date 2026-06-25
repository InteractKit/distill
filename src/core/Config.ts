import { resolve, dirname, relative } from "node:path";
import { PROVIDERS as VALID_PROVIDERS, type ProviderName } from "./Provider.js";

// ─── Config: the single control surface (task.json) ──────────────────────────
// Structured into sections. Paths resolve relative to the task.json directory,
// so commands only ever need `--task`.
//
//   {
//     "instruction": "...",
//     "tags": [ { name, description } ],
//     "examples": [ { input, output } ],
//     "io":    { "data", "cache", "output" },
//     "label": { "model", "concurrency", "temperature", "retries" },
//     "synth": { "model", "rounds", "temperature", "trainFrac", "devFrac" }
//   }

/** One entity type to extract. */
export interface TagSpec {
  /** Short uppercase name, e.g. `"PERSON"`. Used as the `tag` in output. */
  name: string;
  /** Plain-English description. Guides the labeler and the generated code. */
  description: string;
}

/**
 * A few-shot example: an input sentence and the entities it contains.
 *
 * Preferred (structured): `{ input, entities: [{ text, tag }] }`.
 * `entities: []` means "no entities here" — a useful negative example.
 *
 * `output` (a raw `[text](TAG)` string) is still accepted for back-compat but
 * deprecated — that markup is an internal representation; prefer `entities`.
 */
export interface Example {
  /** The input text. */
  input: string;
  /** The entities in this input (structured). Use `[]` for a negative example. */
  entities?: { text: string; tag: string }[];
  /** @deprecated Use `entities`. Raw `[text](TAG)` lines, or `NONE`. */
  output?: string;
}

/** File paths, relative to the config file. */
export interface IoSection {
  /**
   * Raw inputs to learn from - one record per line (`{ "text": "…" }`).
   * @default "data.jsonl"
   */
  data?: string;
  /**
   * Where the labeled corpus is written. Auto-generated and resumable.
   * @default "cache.jsonl"
   */
  cache?: string;
  /**
   * Where the synthesized extractor code is written. Auto-generated -
   * **do not edit by hand**; it's overwritten on every build.
   * @default "extractor.gen.ts"
   */
  output?: string;
}

/** Stage 1 - labeling your examples with an LLM. */
export interface LabelSection {
  /**
   * Which model provider to use for labeling.
   * @default "openai"
   */
  provider?: ProviderName;
  /**
   * Model name for the provider, e.g. `"gpt-4o-mini"`. A light model is fine here.
   * @default "gpt-4o-mini"
   */
  model?: string;
  /**
   * How many inputs to label in parallel.
   * @default 8
   */
  concurrency?: number;
  /**
   * Sampling temperature (0 = deterministic).
   * @default 0
   */
  temperature?: number;
  /**
   * Retry attempts per input on transient errors.
   * @default 2
   */
  retries?: number;
}

/** Evolutionary search settings for the build stage. */
export interface PopulationSection {
  /**
   * How many candidate extractors to keep alive each round.
   * `1` = a single extractor improved step by step (cheapest).
   * `>1` evolves several in parallel and keeps the best - better for hard
   * fields, but roughly `size`× the build cost.
   * @default 1
   */
  size?: number;
  /**
   * How many of the top candidates breed each round.
   * @default ceil(size / 2)
   */
  survivors?: number;
  /**
   * How survivors are chosen each round:
   *  - `"per-tag-niche"` - keep the best specialist for each field plus an
   *    overall generalist, so the candidates stay genuinely different.
   *  - `"top-k"` - keep the highest-scoring candidates (may all converge).
   * @default "per-tag-niche"
   */
  diversity?: "per-tag-niche" | "top-k";
  /**
   * Combine two candidates' per-field strengths into a new one.
   * @default true when size > 1
   */
  crossover?: boolean;
}

/** Stage 2 - synthesizing the extractor code with an LLM. */
export interface SynthSection {
  /**
   * Which model provider writes the extractor code.
   * @default "openai"
   */
  provider?: ProviderName;
  /**
   * Model name for the provider, e.g. `"gpt-5.4-mini"`. A strong model helps here.
   * @default "gpt-5.4-mini"
   */
  model?: string;
  /**
   * How many refinement rounds to run.
   * @default 6
   */
  rounds?: number;
  /**
   * Sampling temperature (ignored by reasoning models).
   * @default 0.2
   */
  temperature?: number;
  /**
   * Fraction of examples used to build the extractor's knowledge.
   * @default 0.7
   */
  trainFrac?: number;
  /**
   * Fraction of examples used to score and guide improvements. The rest is a
   * held-out test set, scored once at the end.
   * @default 0.15
   */
  devFrac?: number;
  /** Evolutionary search settings (see {@link PopulationSection}). */
  population?: PopulationSection;
}

/** `distill host` - serving settings. */
export interface HostSection {
  /**
   * Port for the HTTP server.
   * @default 3000
   */
  port?: number;
  /**
   * In learn mode: rebuild the extractor at most this often (seconds), and only
   * once enough new examples have accumulated.
   * @default 300
   */
  rebuildEverySec?: number;
  /**
   * In learn mode: minimum new captured examples before a rebuild is worthwhile.
   * @default 25
   */
  minNewExamples?: number;
}

/**
 * The config you write in `distill.config.ts` (via {@link defineConfig}) or
 * `task.json`. All fields are optional except `tags`.
 */
export interface DistillConfig {
  /** One line describing the task, shown to the models. */
  instruction?: string;
  /** The entity types (fields) to extract. **Required.** */
  tags: TagSpec[];
  /** Optional few-shot examples - helps small labeling models. */
  examples?: Example[];
  /** File paths (data, cache, output). */
  io?: IoSection;
  /** Stage 1 - labeling settings (provider, model, …). */
  label?: LabelSection;
  /** Stage 2 - code-synthesis settings (provider, model, rounds, population, …). */
  synth?: SynthSection;
  /** `distill host` - serving + learn-mode settings. */
  host?: HostSection;
}

const DEFAULTS = {
  data: "data.jsonl",
  cache: "cache.jsonl",
  output: "extractor.gen.ts",
  labelProvider: (process.env.LABEL_PROVIDER as ProviderName) ?? "openai",
  labelModel: process.env.LABEL_MODEL ?? "gpt-4o-mini",
  labelConcurrency: 8,
  labelTemperature: 0,
  labelRetries: 2,
  synthProvider: (process.env.SYNTH_PROVIDER as ProviderName) ?? "openai",
  synthModel: process.env.SYNTH_MODEL ?? "gpt-5.4-mini",
  rounds: 6,
  synthTemperature: 0.2,
  trainFrac: 0.7,
  devFrac: 0.15,
  hostPort: 3000,
  rebuildEverySec: 300,
  minNewExamples: 25,
} as const;

/** Resolved population settings. */
export interface PopulationConfig {
  size: number;
  survivors: number;
  diversity: "per-tag-niche" | "top-k";
  crossover: boolean;
}

export class Config {
  private constructor(
    readonly taskPath: string,
    readonly baseDir: string,
    readonly instruction: string | undefined,
    readonly tags: TagSpec[],
    readonly examples: Example[] | undefined,
    readonly dataPath: string,
    readonly cachePath: string,
    readonly outputPath: string,
    readonly labelProvider: ProviderName,
    readonly labelModel: string,
    readonly labelConcurrency: number,
    readonly labelTemperature: number,
    readonly labelRetries: number,
    readonly synthProvider: ProviderName,
    readonly synthModel: string,
    readonly rounds: number,
    readonly synthTemperature: number,
    readonly trainFrac: number,
    readonly devFrac: number,
    readonly population: PopulationConfig,
    readonly hostPort: number,
    readonly rebuildEverySec: number,
    readonly minNewExamples: number,
  ) {}

  /** Candidate config filenames, in discovery order, when no path is given. */
  static readonly DISCOVERY = [
    "distill.config.ts",
    "distill.config.js",
    "task.json",
  ];

  /**
   * Load + resolve a config into an immutable Config.
   * - explicit path: used as-is.
   * - no path: discovered in cwd (distill.config.ts → .js → task.json).
   * Dispatches on extension: .ts/.js are imported (default export, may be
   * defineConfig(...) - executable); .json is parsed. Both are supported so
   * humans get a typed TS config while CI/scripts can use plain JSON.
   */
  static async load(taskPath?: string): Promise<Config> {
    const abs = taskPath ? resolve(taskPath) : await Config.discover();
    const baseDir = dirname(abs);
    const task = await Config.readRaw(abs);
    if (!task.tags?.length)
      throw new Error(`${abs}: "tags" must be a non-empty array`);

    const io = task.io ?? {};
    const label = task.label ?? {};
    const synth = task.synth ?? {};
    const rel = (p: string | undefined, def: string) =>
      resolve(baseDir, p ?? def);

    const pop = synth.population ?? {};
    const size = Math.max(1, pop.size ?? 1);
    const population: PopulationConfig = {
      size,
      survivors: Math.max(
        1,
        Math.min(pop.survivors ?? Math.ceil(size / 2), size),
      ),
      diversity: pop.diversity ?? "per-tag-niche",
      crossover: pop.crossover ?? size > 1,
    };

    const host = task.host ?? {};

    const checkProvider = (
      p: string | undefined,
      def: ProviderName,
      where: string,
    ): ProviderName => {
      const v = p ?? def;
      if (!VALID_PROVIDERS.includes(v as ProviderName)) {
        throw new Error(
          `${abs}: ${where}.provider "${v}" is invalid (use ${VALID_PROVIDERS.join(", ")})`,
        );
      }
      return v as ProviderName;
    };

    return new Config(
      abs,
      baseDir,
      task.instruction,
      task.tags,
      task.examples,
      rel(io.data, DEFAULTS.data),
      rel(io.cache, DEFAULTS.cache),
      rel(io.output, DEFAULTS.output),
      checkProvider(label.provider, DEFAULTS.labelProvider, "label"),
      label.model ?? DEFAULTS.labelModel,
      label.concurrency ?? DEFAULTS.labelConcurrency,
      label.temperature ?? DEFAULTS.labelTemperature,
      label.retries ?? DEFAULTS.labelRetries,
      checkProvider(synth.provider, DEFAULTS.synthProvider, "synth"),
      synth.model ?? DEFAULTS.synthModel,
      synth.rounds ?? DEFAULTS.rounds,
      synth.temperature ?? DEFAULTS.synthTemperature,
      synth.trainFrac ?? DEFAULTS.trainFrac,
      synth.devFrac ?? DEFAULTS.devFrac,
      population,
      host.port ?? DEFAULTS.hostPort,
      host.rebuildEverySec ?? DEFAULTS.rebuildEverySec,
      host.minNewExamples ?? DEFAULTS.minNewExamples,
    );
  }

  /** Find the first existing discovery filename in cwd, or throw. */
  private static async discover(): Promise<string> {
    const { access } = await import("node:fs/promises");
    for (const name of Config.DISCOVERY) {
      const p = resolve(process.cwd(), name);
      try {
        await access(p);
        return p;
      } catch {
        // not present; try next
      }
    }
    throw new Error(
      `No config found. Looked for ${Config.DISCOVERY.join(", ")} in ${process.cwd()}. ` +
        `Run \`distill init\` to scaffold one, or pass --task <path>.`,
    );
  }

  /** Read a raw config object from a .ts/.js (import default) or .json file. */
  private static async readRaw(abs: string): Promise<DistillConfig> {
    if (/\.json$/i.test(abs)) {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile(abs, "utf8")) as DistillConfig;
    }
    // .ts / .js / .mjs config. Plain Node can't import TypeScript, and the
    // installed CLI runs under plain Node - so we load it through tsx's
    // programmatic loader (`tsImport`), which transpiles on the fly without
    // registering a global hook. Works whether or not the caller used tsx.
    const { pathToFileURL } = await import("node:url");
    const { tsImport } = await import("tsx/esm/api");
    let mod: { default?: unknown };
    try {
      mod = (await tsImport(pathToFileURL(abs).href, import.meta.url)) as {
        default?: unknown;
      };
    } catch (err) {
      throw new Error(
        `failed to load config ${abs}: ${(err as Error).message}`,
      );
    }
    if (!mod.default) {
      throw new Error(
        `${abs}: expected a default export (use \`export default defineConfig({...})\`).`,
      );
    }
    return mod.default as DistillConfig;
  }

  /** A path relative to the task dir, for display. */
  rel(p: string): string {
    return relative(this.baseDir, p) || p;
  }

  get tagNames(): string[] {
    return this.tags.map((t) => t.name);
  }

  /**
   * Examples normalized to the internal `[text](TAG)` markup the prompts use.
   * Accepts either structured `entities` (preferred) or a raw `output` string
   * (deprecated). Returns `{ input, output }[]`.
   */
  get normalizedExamples(): { input: string; output: string }[] {
    return (this.examples ?? []).map((ex) => {
      if (ex.entities) {
        const output = ex.entities.length
          ? ex.entities.map((e) => `[${e.text}](${e.tag})`).join("\n")
          : "NONE";
        return { input: ex.input, output };
      }
      return { input: ex.input, output: ex.output ?? "NONE" };
    });
  }
}
