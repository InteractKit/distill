import type {
  EvalReport,
  GeneratedExtractor,
  GoldEntity,
  LabeledRow,
  RowError,
  Split,
  TagScore,
} from "../domain/types.js";
import type { LabelStore } from "./LabelStore.js";

// ─── Evaluator: scores a generated extractor against gold labels ─────────────
// NER scoring uses exact span+tag match (multiset): a predicted entity is a TP
// only if some unmatched gold entity has the same text (case-insensitive) and
// the same tag.

export class Evaluator {
  private readonly validTags?: Set<string>;

  /**
   * @param store      the train-only knowledge the extractor needs
   * @param validTags  if given, only these tags are scored/reported; any gold or
   *                   predicted entity with another tag is ignored. Keeps the
   *                   report clean even if the cache contains stray tags.
   */
  constructor(
    private readonly store: LabelStore,
    validTags?: readonly string[],
  ) {
    this.validTags = validTags ? new Set(validTags) : undefined;
  }

  /** Canonical key for set-based matching: case-insensitive text + exact tag. */
  private static key(e: GoldEntity): string {
    return `${e.text.trim().toLowerCase()} ${e.tag}`;
  }

  /** Keep only entities whose tag is in the configured set (if one was given). */
  private filter(entities: GoldEntity[]): GoldEntity[] {
    return this.validTags ? entities.filter((e) => this.validTags!.has(e.tag)) : entities;
  }

  /** Run the extractor over one row, swallowing crashes as "predicted nothing". */
  private predict(extractor: GeneratedExtractor, input: string): GoldEntity[] {
    try {
      return this.filter(extractor(input, this.store) ?? []);
    } catch {
      return [];
    }
  }

  /** Score an extractor over rows → per-tag + micro/macro F1. */
  score(extractor: GeneratedExtractor, rows: LabeledRow[], split: Split): EvalReport {
    const acc = new Map<string, { tp: number; fp: number; fn: number }>();
    const get = (tag: string) => {
      let s = acc.get(tag);
      if (!s) acc.set(tag, (s = { tp: 0, fp: 0, fn: 0 }));
      return s;
    };

    for (const row of rows) {
      const pred = this.predict(extractor, row.input);
      const gold = this.filter(row.entities);
      // key → { tag, count }. Keep the tag explicitly — don't reconstruct it
      // from the key, since spans can contain spaces (multi-word entities).
      const goldRemaining = new Map<string, { tag: string; count: number }>();
      for (const g of gold) {
        const k = Evaluator.key(g);
        const cur = goldRemaining.get(k);
        if (cur) cur.count++;
        else goldRemaining.set(k, { tag: g.tag, count: 1 });
      }
      for (const p of pred) {
        const k = Evaluator.key(p);
        const cur = goldRemaining.get(k);
        if (cur && cur.count > 0) {
          cur.count--;
          get(p.tag).tp++;
        } else {
          get(p.tag).fp++;
        }
      }
      for (const { tag, count } of goldRemaining.values()) {
        if (count > 0) get(tag).fn += count;
      }
    }

    const perTag: TagScore[] = [...acc.entries()]
      .map(([tag, { tp, fp, fn }]) => {
        const { p, r, f1 } = Evaluator.prf(tp, fp, fn);
        return { tag, precision: p, recall: r, f1, tp, fp, fn };
      })
      .sort((a, b) => a.tag.localeCompare(b.tag));

    let TP = 0,
      FP = 0,
      FN = 0;
    for (const s of perTag) {
      TP += s.tp;
      FP += s.fp;
      FN += s.fn;
    }
    const microF1 = Evaluator.prf(TP, FP, FN).f1;
    const macroF1 = perTag.length ? perTag.reduce((a, s) => a + s.f1, 0) / perTag.length : 0;

    return { split, perTag, microF1, macroF1 };
  }

  /** Collect per-row disagreements for the refine loop. */
  errors(extractor: GeneratedExtractor, rows: LabeledRow[]): RowError[] {
    const out: RowError[] = [];
    for (const row of rows) {
      const pred = this.predict(extractor, row.input);
      const gold = this.filter(row.entities);
      const goldKeys = new Map<string, number>();
      for (const g of gold) goldKeys.set(Evaluator.key(g), (goldKeys.get(Evaluator.key(g)) ?? 0) + 1);
      const predKeys = new Map<string, number>();
      for (const p of pred) predKeys.set(Evaluator.key(p), (predKeys.get(Evaluator.key(p)) ?? 0) + 1);

      const falsePos = pred.filter((p) => (goldKeys.get(Evaluator.key(p)) ?? 0) === 0);
      const falseNeg = gold.filter((g) => (predKeys.get(Evaluator.key(g)) ?? 0) === 0);
      if (falsePos.length || falseNeg.length) {
        out.push({ input: row.input, gold, predicted: pred, falsePos, falseNeg });
      }
    }
    return out;
  }

  private static prf(tp: number, fp: number, fn: number): { p: number; r: number; f1: number } {
    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
    return { p, r, f1 };
  }
}
