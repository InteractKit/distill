import type { Example, TagSpec } from "./Config.js";
import type { EvalReport, GoldEntity, RowError } from "../domain/types.js";

// ─── PromptFactory: builds the generate/refine prompts ───────────────────────
// Static-only. The generated extractor is import-free: it declares `extract` and
// reads from a `store` parameter. At ship time the bundler inlines a LabelStore
// implementation + the train data and defaults `store` to it, making the file
// fully self-contained (no `@interactkit/distill` dependency).

export class PromptFactory {
  /** The contract every generated extractor must satisfy. */
  static contract(): string {
    return `
The file MUST be valid TypeScript (ESM) and export exactly:

    export function extract(text: string, store: LabelStore): { text: string; tag: string }[] { ... }

\`LabelStore\` is provided ambiently — do NOT import it or any other module, and
do NOT redefine its type. Just use the \`store\` parameter directly.

Rules:
- Return an array of { text, tag } where \`text\` is a substring that appears
  VERBATIM in \`text\` (same casing) and \`tag\` is one of the allowed tags.
- Pure function: no I/O, no network, NO imports at all (not even types).
- Use \`store\` for knowledge, NOT hardcoded data:
    store.vocab: Map<tag, Set<lowercased-span>>     // exact spans seen in TRAIN
    store.hasVocab(tag, span): boolean
    store.tagsForSpan(span): string[]
    store.prevTokenTagProb(prevToken, tag): number  // P(tag | preceding word)
    store.bestTagAfter(prevToken): {tag, prob}|null
    store.suffixTagProb(suffixWord, tag): number    // P(tag | span's last word)
    store.bestTagForSuffix(suffixWord): {tag, prob}|null
- The store only contains TRAIN data, so looking up vocab generalizes honestly.
- DO NOT hardcode specific entity values (e.g. \`text.includes("Priya Nair")\`).
  Write GENERAL rules: regex for structured tags (YEARS, DEGREE), vocab lookups
  for closed tags (SKILL, COMPANY), context-stat heuristics for open tags
  (CANDIDATE, ROLE). Prefer rules that work on unseen inputs.
`.trim();
  }

  /**
   * Seed variants steer the INITIAL drafts toward different strategies so a
   * population starts diverse instead of N near-identical files. Index into this
   * list cyclically when seeding `size` candidates.
   */
  static readonly SEED_VARIANTS: { key: string; hint: string }[] = [
    {
      key: "regex-first",
      hint: "Lead with precise REGEX for structured tags (durations, degrees, IDs); use the store only as a fallback.",
    },
    {
      key: "vocab-first",
      hint: "Lead with LabelStore VOCAB LOOKUPS (store.tagsForSpan / hasVocab) over candidate spans; add regex only where vocab can't reach.",
    },
    {
      key: "context-first",
      hint: "Lead with CONTEXT STATISTICS (store.bestTagAfter / suffixTagProb) so open-class tags (names, roles) generalize to unseen spans.",
    },
    {
      key: "balanced",
      hint: "Balance regex (structured), vocab (closed), and context stats (open) per tag, choosing the strongest mechanism for each.",
    },
  ];

  /** Initial full-file generation prompt. `variantHint` biases the strategy. */
  static generate(args: {
    tags: TagSpec[];
    instruction?: string;
    storeSummary: string;
    examples: { input: string; entities: GoldEntity[] }[];
    variantHint?: string;
  }): { system: string; user: string } {
    const tagList = args.tags
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");
    const examples = args.examples
      .map(
        (e) =>
          `Input: ${e.input}\nGold: ${e.entities.map((x) => `[${x.text}](${x.tag})`).join(" ")}`,
      )
      .join("\n\n");

    const strategy = args.variantHint
      ? `\n\nStrategy for this draft: ${args.variantHint}`
      : "";
    const system = `You write a TypeScript entity extractor as CODE. ${
      args.instruction ?? ""
    }\n\n${PromptFactory.contract()}`;

    const user = `Allowed tags:\n${tagList}

Knowledge available via the train-only LabelStore:
${args.storeSummary}

A few TRAIN examples (for shape; the real data is larger):
${examples}${strategy}

Write the initial extractor. Output ONLY the TypeScript source, no fences, no commentary.`;

    return { system, user };
  }

  /**
   * Crossover prompt: combine two parent extractors into a child that takes the
   * stronger mechanism per tag. The child author sees both full sources and a
   * per-tag breakdown of which parent wins each tag.
   */
  static crossover(args: {
    parentA: { source: string; perTag: { tag: string; f1: number }[] };
    parentB: { source: string; perTag: { tag: string; f1: number }[] };
  }): { system: string; user: string } {
    const tags = new Set(
      [...args.parentA.perTag, ...args.parentB.perTag].map((t) => t.tag),
    );
    const f1 = (p: { perTag: { tag: string; f1: number }[] }, tag: string) =>
      p.perTag.find((t) => t.tag === tag)?.f1 ?? 0;
    const breakdown = [...tags]
      .map((tag) => {
        const a = f1(args.parentA, tag);
        const b = f1(args.parentB, tag);
        const winner = a >= b ? "A" : "B";
        return `  ${tag}: A=${a.toFixed(2)} B=${b.toFixed(2)} → take from ${winner}`;
      })
      .join("\n");

    const system = `You combine two TypeScript entity extractors into ONE better child. ${PromptFactory.contract()}

Take the stronger implementation FOR EACH TAG from whichever parent handles it better, and merge into a single coherent extractor. Output ONLY the complete TypeScript source, no fences, no commentary.`;

    const user = `Per-tag F1 (who wins each tag):
${breakdown}

=== Parent A ===
${args.parentA.source}

=== Parent B ===
${args.parentB.source}

Write the merged child extractor.`;

    return { system, user };
  }

  /** System + user for the agentic refine pass (source is read via tools). */
  static refine(args: {
    devReport: EvalReport;
    errors: RowError[];
    hardcodeWarnings: string[];
    maxErrors?: number;
  }): { system: string; user: string } {
    const maxErrors = args.maxErrors ?? 25;
    const errSample = args.errors
      .slice(0, maxErrors)
      .map((e) => {
        const fp =
          e.falsePos.map((x) => `[${x.text}](${x.tag})`).join(" ") || "-";
        const fn =
          e.falseNeg.map((x) => `[${x.text}](${x.tag})`).join(" ") || "-";
        return `Input: ${e.input}\n  MISSED: ${fn}\n  WRONG: ${fp}`;
      })
      .join("\n\n");
    const perTag = args.devReport.perTag
      .map(
        (s) =>
          `  ${s.tag}: F1=${s.f1.toFixed(2)} (P=${s.precision.toFixed(2)} R=${s.recall.toFixed(2)})`,
      )
      .join("\n");
    const warn = args.hardcodeWarnings.length
      ? `\n\nWARNING: previous version hardcodes specific values: ${args.hardcodeWarnings
          .map((w) => `"${w}"`)
          .join(", ")} - replace with general rules.`
      : "";

    const system = `You improve a TypeScript entity extractor to raise its F1 on a held-out DEV set. ${PromptFactory.contract()}

Work in this order, using the tools:

1. DIAGNOSE — call \`failure_stats\` (optionally per weak tag) to see the most
   FREQUENT spans you tag wrongly (false positives) and miss (false negatives).
   This reveals SYSTEMATIC errors — e.g. one stop-list or boundary rule can kill
   many same-span false positives at once. Use \`list_failures\` to page through
   raw rows and see a span in context when you need it.
2. LOCATE — use \`read_lines\` / \`grep\` to find the code responsible.
3. FIX — emit SEARCH/REPLACE diff blocks.

Aim for the BIGGEST wins first: target the highest-count errors and the weakest
tags, not one-off cases. A rule that removes 80 false positives beats 5 tiny edits.

Output ONLY SEARCH/REPLACE diff blocks:

\<<<<<<< SEARCH
<exact lines copied verbatim from what read_lines returned>
=======
<the replacement lines>
>>>>>>> REPLACE

Diff rules:
- SEARCH must match the current source EXACTLY (copy from read_lines output; do NOT include the "NN| " line-number prefix).
- Keep each block small; add context lines only to disambiguate.
- Emit multiple blocks for multiple edits.
- Final message = diff blocks only. No prose, no fences, no full-file dumps.
- Use GENERAL rules (regex, store lookups, context stats). Never hardcode entity values.`;

    const user = `Current dev scores:
${perTag}
micro F1 = ${args.devReport.microF1.toFixed(3)}

Start with \`failure_stats\` to find the systematic errors, then fix the biggest ones.
A few sample failures to get you oriented:
${errSample}
${warn}`;

    return { system, user };
  }
}
