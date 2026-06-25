// ─── Shared domain types ─────────────────────────────────────────────────────

/** One gold-labeled span. */
export interface GoldEntity {
  text: string;
  tag: string;
}

/** One labeled row, as found in the cache (cache.jsonl). */
export interface LabeledRow {
  input: string;
  entities: GoldEntity[];
}

/** Which slice of the data a row belongs to. */
export type Split = "train" | "dev" | "test";

/**
 * The function a *generated* extractor must export. Text in, spans out.
 *
 * During the build loop it receives a train-only LabelStore so it can look up
 * known vocab / context statistics without ever seeing dev or test labels. The
 * SHIPPED artifact bundles its own store and defaults this arg, so the store is
 * optional - `extract(text)` runs standalone.
 */
export type GeneratedExtractor = (
  text: string,
  store?: import("../core/LabelStore.js").LabelStore,
) => GoldEntity[];

/** Per-tag precision/recall/F1 plus support counts. */
export interface TagScore {
  tag: string;
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

/** A full evaluation over one split. */
export interface EvalReport {
  split: Split;
  perTag: TagScore[];
  microF1: number;
  macroF1: number;
}

/** A predicted-vs-gold disagreement on one row, for the refine loop. */
export interface RowError {
  input: string;
  gold: GoldEntity[];
  predicted: GoldEntity[];
  falsePos: GoldEntity[];
  falseNeg: GoldEntity[];
}
