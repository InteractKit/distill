import { readFile, writeFile } from "node:fs/promises";

// ─── Champion: the warm-start sidecar ────────────────────────────────────────
// The shipped `extractor.gen.ts` is BUNDLED (inlined LabelStore + serialized
// data), which is great for running but not for re-seeding the synth loop - the
// loop works with raw `extract(text, store)` source. So at ship time we also
// persist the champion's RAW (pre-bundle) source plus a little metadata to a
// sidecar. The next `distill build` reads it and seeds generation 0 from it
// instead of asking the LLM for a brand-new draft - so new data IMPROVES the
// existing extractor rather than rebuilding it from scratch.
//
// The sidecar lives beside the output (e.g. `extractor.gen.meta.json`). It's a
// derived artifact - gitignored, regenerated every build.

export interface ChampionMeta {
  /** Raw champion source: `export function extract(text, store) {...}`. */
  source: string;
  /** Tag set this champion was built for. A mismatch forces a fresh build. */
  tags: string[];
  /** Best dev micro-F1 it achieved (for reporting the warm-start baseline). */
  devMicroF1: number;
}

export class Champion {
  /** Sidecar path for a given output path: `foo.gen.ts` → `foo.gen.meta.json`. */
  static metaPath(outputPath: string): string {
    return outputPath.replace(/(\.[^.]+)?$/, ".meta.json");
  }

  /** Persist the champion sidecar beside `outputPath`. */
  static async save(outputPath: string, meta: ChampionMeta): Promise<void> {
    await writeFile(
      Champion.metaPath(outputPath),
      JSON.stringify(meta, null, 2) + "\n",
      "utf8",
    );
  }

  /** Load the sidecar, or null if absent / unreadable / malformed. */
  static async load(outputPath: string): Promise<ChampionMeta | null> {
    try {
      const raw = await readFile(Champion.metaPath(outputPath), "utf8");
      const m = JSON.parse(raw) as Partial<ChampionMeta>;
      if (typeof m.source !== "string" || !Array.isArray(m.tags)) return null;
      return {
        source: m.source,
        tags: m.tags as string[],
        devMicroF1: typeof m.devMicroF1 === "number" ? m.devMicroF1 : 0,
      };
    } catch {
      return null;
    }
  }

  /** Same tag set (order-insensitive)? A change means the prior source is stale. */
  static tagsMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sb = new Set(b);
    return a.every((t) => sb.has(t));
  }
}
