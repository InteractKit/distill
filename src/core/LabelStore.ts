import type { LabeledRow } from "../domain/types.js";

// ─── Tokenisation (shared, so context stats line up with lookups) ────────────
/** Lowercased word tokens. Kept deliberately simple and deterministic. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9.+#]+/g) ?? [];
}

const SENTINEL_BOS = "bos"; // virtual "beginning of string" token

/**
 * The serialized form of a LabelStore - the derived tables only, no raw rows.
 * Small (a few KB), JSON-safe, and reproduces every lookup exactly. Embedded
 * into the self-contained generated artifact so it carries its own knowledge.
 */
export interface LabelStoreData {
  vocab: [string, string[]][]; // tag → spans
  prevTokenTag: [string, [string, number][]][]; // prevToken → tag → count
  suffixTag: [string, [string, number][]][]; // suffix → tag → count
  tagSpanCount: [string, number][]; // tag → span count
}

// ─── LabelStore ──────────────────────────────────────────────────────────────
/**
 * Read-only knowledge derived from the TRAIN split ONLY.
 *
 * This is both an ergonomic layer (generated code calls `store.skills.has(x)`
 * instead of pasting vocab) and a guardrail: dev/test labels are physically
 * unreachable here, so the synth loop cannot look up eval answers, and the
 * generated extractor cannot leak them.
 *
 * It exposes two kinds of knowledge:
 *   1. Vocab sets  - exact spans seen per tag (good for closed tags: SKILL…).
 *   2. Context stats - P(tag | preceding token), suffix→tag tables, etc.
 *      These let generated code generalize to UNSEEN spans (the open tags:
 *      CANDIDATE / ROLE), which a raw vocab list cannot do.
 */
export class LabelStore {
  /** Tag name → set of lowercased exact spans seen with that tag. */
  readonly vocab: Map<string, Set<string>>;
  /** All tag names present in the train data. */
  readonly tags: string[];

  // preceding-token → tag → count, over the token immediately before a span.
  private readonly prevTokenTag: Map<string, Map<string, number>>;
  // trailing word suffix (last token of a span) → tag → count.
  private readonly suffixTag: Map<string, Map<string, number>>;
  // tag → number of spans (for priors / smoothing).
  private readonly tagSpanCount: Map<string, number>;

  private constructor(rows: LabeledRow[], data?: LabelStoreData) {
    this.vocab = new Map();
    this.prevTokenTag = new Map();
    this.suffixTag = new Map();
    this.tagSpanCount = new Map();

    // Restore directly from serialized tables (self-contained artifact path).
    if (data) {
      for (const [tag, spans] of data.vocab)
        this.vocab.set(tag, new Set(spans));
      for (const [k, counts] of data.prevTokenTag)
        this.prevTokenTag.set(k, new Map(counts));
      for (const [k, counts] of data.suffixTag)
        this.suffixTag.set(k, new Map(counts));
      for (const [tag, n] of data.tagSpanCount) this.tagSpanCount.set(tag, n);
      this.tags = [...this.tagSpanCount.keys()].sort();
      return;
    }

    for (const row of rows) {
      const inputLower = row.input.toLowerCase();
      for (const ent of row.entities) {
        const spanLower = ent.text.toLowerCase().trim();
        if (!spanLower) continue;

        // 1. vocab
        addToSet(this.vocab, ent.tag, spanLower);
        bump(this.tagSpanCount, ent.tag);

        // 2a. preceding-token context: find the span, look at the word before it.
        const at = inputLower.indexOf(spanLower);
        const before = at >= 0 ? inputLower.slice(0, at) : "";
        const prevTokens = tokenize(before);
        const prev = prevTokens.length
          ? prevTokens[prevTokens.length - 1]
          : SENTINEL_BOS;
        addCount(this.prevTokenTag, prev, ent.tag);

        // 2b. suffix context: last token of the span (e.g. "engineer", "inc").
        const spanTokens = tokenize(spanLower);
        if (spanTokens.length) {
          addCount(this.suffixTag, spanTokens[spanTokens.length - 1], ent.tag);
        }
      }
    }

    this.tags = [...this.tagSpanCount.keys()].sort();
  }

  /** Build from rows already filtered to the TRAIN split. */
  static fromTrain(trainRows: LabeledRow[]): LabelStore {
    return new LabelStore(trainRows);
  }

  /** Rebuild from a previously serialized payload (see {@link toData}). */
  static fromData(data: LabelStoreData): LabelStore {
    return new LabelStore([], data);
  }

  /** Serialize the derived tables to a small, JSON-safe payload. */
  toData(): LabelStoreData {
    return {
      vocab: [...this.vocab].map(([t, s]) => [t, [...s]]),
      prevTokenTag: [...this.prevTokenTag].map(([k, m]) => [k, [...m]]),
      suffixTag: [...this.suffixTag].map(([k, m]) => [k, [...m]]),
      tagSpanCount: [...this.tagSpanCount],
    };
  }

  // ─── Vocab lookups ─────────────────────────────────────────────────────────
  /** Was this exact span (case-insensitive) ever labeled with `tag`? */
  hasVocab(tag: string, span: string): boolean {
    return this.vocab.get(tag)?.has(span.toLowerCase().trim()) ?? false;
  }

  /** Tags this exact span was ever labeled as, if any. */
  tagsForSpan(span: string): string[] {
    const s = span.toLowerCase().trim();
    return this.tags.filter((t) => this.vocab.get(t)?.has(s));
  }

  // ─── Context statistics (the generalization handles) ─────────────────────────
  /**
   * P(tag | the token immediately before a span is `prevToken`).
   * e.g. prevToken "at" → high P(COMPANY). Lets code tag UNSEEN companies.
   * Use SENTINEL_BOS-equivalent by passing "" for start-of-string.
   */
  prevTokenTagProb(prevToken: string, tag: string): number {
    const key = prevToken ? prevToken.toLowerCase() : SENTINEL_BOS;
    return dist(this.prevTokenTag.get(key)).get(tag) ?? 0;
  }

  /** The most likely tag given the preceding token, with its probability. */
  bestTagAfter(prevToken: string): { tag: string; prob: number } | null {
    const key = prevToken ? prevToken.toLowerCase() : SENTINEL_BOS;
    return argmax(dist(this.prevTokenTag.get(key)));
  }

  /** P(tag | a span ends in the word `suffixWord`). e.g. "engineer" → ROLE. */
  suffixTagProb(suffixWord: string, tag: string): number {
    return dist(this.suffixTag.get(suffixWord.toLowerCase())).get(tag) ?? 0;
  }

  /** Most likely tag for a span ending in `suffixWord`. */
  bestTagForSuffix(suffixWord: string): { tag: string; prob: number } | null {
    return argmax(dist(this.suffixTag.get(suffixWord.toLowerCase())));
  }

  /** A compact, model-readable summary of the stats - fed into the synth prompt. */
  describe(topN = 12): string {
    const lines: string[] = [];
    lines.push(`Tags: ${this.tags.join(", ")}`);
    lines.push(
      `Vocab sizes: ${this.tags
        .map((t) => `${t}=${this.vocab.get(t)?.size ?? 0}`)
        .join(", ")}`,
    );
    lines.push("Top preceding-token -> tag cues:");
    for (const line of topCues(this.prevTokenTag, topN))
      lines.push("  " + line);
    lines.push("Top span-suffix -> tag cues:");
    for (const line of topCues(this.suffixTag, topN)) lines.push("  " + line);
    return lines.join("\n");
  }
}

// ─── small helpers ───────────────────────────────────────────────────────────
function addToSet(m: Map<string, Set<string>>, k: string, v: string): void {
  let s = m.get(k);
  if (!s) m.set(k, (s = new Set()));
  s.add(v);
}
function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function addCount(
  m: Map<string, Map<string, number>>,
  k: string,
  tag: string,
): void {
  let inner = m.get(k);
  if (!inner) m.set(k, (inner = new Map()));
  inner.set(tag, (inner.get(tag) ?? 0) + 1);
}
/** Normalise a count map into a probability distribution. */
function dist(counts?: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (!counts) return out;
  let total = 0;
  for (const v of counts.values()) total += v;
  if (total === 0) return out;
  for (const [k, v] of counts) out.set(k, v / total);
  return out;
}
function argmax(d: Map<string, number>): { tag: string; prob: number } | null {
  let best: { tag: string; prob: number } | null = null;
  for (const [tag, prob] of d) {
    if (!best || prob > best.prob) best = { tag, prob };
  }
  return best;
}
/** Top-N "key -> bestTag (p=..)" lines for the prompt summary. */
function topCues(m: Map<string, Map<string, number>>, n: number): string[] {
  const scored: { key: string; tag: string; prob: number; support: number }[] =
    [];
  for (const [key, counts] of m) {
    if (key === SENTINEL_BOS) continue;
    let support = 0;
    for (const v of counts.values()) support += v;
    const best = argmax(dist(counts));
    if (best) scored.push({ key, tag: best.tag, prob: best.prob, support });
  }
  // Favour cues that are both confident and well-supported.
  scored.sort(
    (a, b) =>
      b.prob * Math.log(1 + b.support) - a.prob * Math.log(1 + a.support),
  );
  return scored
    .slice(0, n)
    .map(
      (s) => `"${s.key}" -> ${s.tag} (p=${s.prob.toFixed(2)}, n=${s.support})`,
    );
}
