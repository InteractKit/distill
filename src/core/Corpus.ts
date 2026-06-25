import { readFile } from "node:fs/promises";
import type { LabeledRow, Split } from "../domain/types.js";

// ─── Corpus: labeled rows + a deterministic train/dev/test split ─────────────
// A row's split is derived from a stable hash of its input text (NOT its
// position), so adding/removing rows never reshuffles existing assignments - a
// row keeps its split for the life of the dataset. That is what keeps the test
// set genuinely held-out across synth rounds and data updates.

export interface SplitConfig {
  trainFrac: number;
  devFrac: number;
  // test = 1 - train - dev
}

export interface Partitioned {
  train: LabeledRow[];
  dev: LabeledRow[];
  test: LabeledRow[];
}

export class Corpus {
  constructor(
    readonly rows: LabeledRow[],
    private readonly split: SplitConfig,
  ) {}

  /**
   * Load labeled rows from a JSONL cache and attach split config.
   * @param validTags  if given, entities with any other tag are dropped on load
   *                   — self-heals caches that contain stray tags from old runs.
   */
  static async fromCache(
    path: string,
    split: SplitConfig,
    validTags?: readonly string[],
  ): Promise<Corpus> {
    const raw = await readFile(path, "utf8");
    const valid = validTags ? new Set(validTags) : undefined;
    const rows: LabeledRow[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const obj = JSON.parse(t) as Partial<LabeledRow>;
      if (typeof obj.input === "string" && Array.isArray(obj.entities)) {
        const entities = valid ? obj.entities.filter((e) => valid.has(e.tag)) : obj.entities;
        rows.push({ input: obj.input, entities });
      }
    }
    return new Corpus(rows, split);
  }

  get size(): number {
    return this.rows.length;
  }

  /** FNV-1a 32-bit hash → stable [0,1) bucket for a string. */
  private static hashUnit(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0x100000000;
  }

  /** Split assignment for one input (stable for a given string). */
  splitOf(input: string): Split {
    const u = Corpus.hashUnit(input);
    if (u < this.split.trainFrac) return "train";
    if (u < this.split.trainFrac + this.split.devFrac) return "dev";
    return "test";
  }

  /** Partition all rows into the three splits. */
  partition(): Partitioned {
    const out: Partitioned = { train: [], dev: [], test: [] };
    for (const row of this.rows) out[this.splitOf(row.input)].push(row);
    return out;
  }
}
