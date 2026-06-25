import "dotenv/config";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { generateObject } from "ai";
import { z } from "zod";
import type { Config } from "./Config.js";
import { Provider } from "./Provider.js";
import { InputSource } from "./InputSource.js";
import type { Reporter } from "../ui/Reporter.js";
import type { GoldEntity, LabeledRow } from "../domain/types.js";

// Ensure the AI SDK warning suppression is active even if LlmClient wasn't loaded.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

export interface LabelStats {
  total: number;
  cached: number;
  labeled: number;
  entities: number;
}

// ─── Labeler: data.txt → cache.jsonl via a light OpenAI model ────────────────
// cache.jsonl IS the labeled corpus. Each raw line is labeled once and reused;
// re-runs only label uncached lines (resumable). Structured output (zod schema
// constrained to the task tags) gives validated { text, tag } arrays directly.

export class Labeler {
  constructor(
    private readonly cfg: Config,
    private readonly reporter: Reporter,
  ) {}

  /** Wipe the cache (e.g. after a label-model change). */
  async reset(): Promise<void> {
    await writeFile(this.cfg.cachePath, "", "utf8");
  }

  private labelFn?: (text: string) => Promise<GoldEntity[]>;

  /**
   * Label a single text with the LLM (used by `host --learn` to serve answers
   * and capture them). Returns the extracted entities. The label function is
   * built once and reused across calls.
   */
  async labelOne(text: string): Promise<GoldEntity[]> {
    if (!this.labelFn) this.labelFn = this.makeLabelFn();
    return this.labelFn(text);
  }

  /** Append a labeled row to the cache file (deduped by the caller). */
  async appendToCache(row: LabeledRow): Promise<void> {
    await appendFile(this.cfg.cachePath, JSON.stringify(row) + "\n", "utf8");
  }

  /** Ensure every input record is labeled in the cache; returns the full corpus. */
  async ensure(): Promise<{ rows: LabeledRow[]; stats: LabelStats }> {
    // Cache is keyed by input TEXT (ids are presentation-only at run time).
    const records = await InputSource.fromFile(this.cfg.dataPath);
    const lines = records.map((r) => r.text);
    const cache = await this.loadCache();
    const todo = lines.filter((l) => !cache.has(l));

    this.reporter.info(
      `${lines.length} inputs · ${lines.length - todo.length} cached · ${todo.length} to label`,
    );

    if (todo.length > 0) {
      this.reporter.note(
        `${this.cfg.labelProvider}:${this.cfg.labelModel} · concurrency: ${this.cfg.labelConcurrency}`,
      );
      await this.labelMissing(todo, cache);
    }

    // Return rows in data.txt order, de-duplicated by input.
    const seen = new Set<string>();
    const rows: LabeledRow[] = [];
    let entityCount = 0;
    for (const l of lines) {
      if (seen.has(l)) continue;
      seen.add(l);
      const row = cache.get(l);
      if (row) {
        rows.push(row);
        entityCount += row.entities.length;
      }
    }
    return {
      rows,
      stats: {
        total: lines.length,
        cached: lines.length - todo.length,
        labeled: todo.length,
        entities: entityCount,
      },
    };
  }

  // ── internals ──
  private async loadCache(): Promise<Map<string, LabeledRow>> {
    const byInput = new Map<string, LabeledRow>();
    let raw: string;
    try {
      raw = await readFile(this.cfg.cachePath, "utf8");
    } catch {
      return byInput;
    }
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as Partial<LabeledRow>;
        if (typeof obj.input === "string" && Array.isArray(obj.entities)) {
          byInput.set(obj.input, { input: obj.input, entities: obj.entities });
        }
      } catch {
        // skip malformed cache lines
      }
    }
    return byInput;
  }

  private async labelMissing(
    todo: string[],
    cache: Map<string, LabeledRow>,
  ): Promise<void> {
    const label = this.makeLabelFn();
    const bar = this.reporter.progress(todo.length, "labeling");

    let done = 0;
    let nextIdx = 0;
    let totalEnts = 0;
    const writes: Promise<void>[] = [];

    const worker = async (): Promise<void> => {
      while (nextIdx < todo.length) {
        const input = todo[nextIdx++];
        const entities = await label(input);
        const row: LabeledRow = { input, entities };
        cache.set(input, row);
        totalEnts += entities.length;
        writes.push(
          appendFile(this.cfg.cachePath, JSON.stringify(row) + "\n", "utf8"),
        );
        done++;
        bar.update(done, `~${(totalEnts / done).toFixed(1)} entities/row`);
      }
    };

    const pool = Math.max(1, Math.min(this.cfg.labelConcurrency, todo.length));
    await Promise.all(Array.from({ length: pool }, () => worker()));
    await Promise.all(writes);
    bar.done(`${todo.length} rows · ${totalEnts} entities`);
  }

  /** Build the per-input structured-output labeling function. */
  private makeLabelFn(): (text: string) => Promise<GoldEntity[]> {
    // Resolves the backend and validates the required key for the chosen provider.
    const model = Provider.model(this.cfg.labelProvider, this.cfg.labelModel);
    const tagNames = this.cfg.tagNames as [string, ...string[]];
    const schema = z.object({
      entities: z
        .array(
          z.object({
            text: z
              .string()
              .describe("The exact span from the input, copied verbatim."),
            tag: z.enum(tagNames).describe("One of the allowed tags."),
          }),
        )
        .describe("All entities found in the input; empty array if none."),
    });

    const tagDoc = this.cfg.tags
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");
    const examples = this.cfg.normalizedExamples;
    const exampleDoc = examples.length
      ? "\n\nExamples:\n" +
        examples.map((e) => `Input: ${e.input}\nOutput: ${e.output}`).join("\n\n")
      : "";
    const system = `${this.cfg.instruction ?? "Extract entities from the text."}

Allowed tags:
${tagDoc}

Copy each entity's text EXACTLY as it appears in the input. Use only the allowed tags. If there are no entities, return an empty list.${exampleDoc}`;

    const retries = this.cfg.labelRetries;
    const temperature = this.cfg.labelTemperature;

    return async (text: string): Promise<GoldEntity[]> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const { object } = await generateObject({
            model,
            schema,
            system,
            prompt: `Input: ${text}`,
            temperature,
          });
          // Two guards before an entity is accepted into the corpus:
          //  1. tag must be in the configured set (the model sometimes invents
          //     tags despite the schema/prompt — never let those into training).
          //  2. span must appear verbatim (case-insensitive) in the input
          //     (drops hallucinated text).
          const valid = new Set(this.cfg.tagNames);
          const out: GoldEntity[] = [];
          const lower = text.toLowerCase();
          for (const e of object.entities) {
            if (!valid.has(e.tag)) continue;
            const at = lower.indexOf(e.text.toLowerCase());
            if (at === -1) continue;
            out.push({ text: text.slice(at, at + e.text.length), tag: e.tag });
          }
          return out;
        } catch (err) {
          if (attempt === retries) throw err;
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      return [];
    };
  }
}
