// ─── DiffEngine: AlphaEvolve-style SEARCH/REPLACE diff blocks ────────────────
// The refine LLM returns edits as:
//
//   <<<<<<< SEARCH
//   <exact current code to find>
//   =======
//   <new code to replace it with>
//   >>>>>>> REPLACE
//
// Each is applied by locating the SEARCH text VERBATIM in the source and
// swapping in REPLACE. Content-anchored (not line-numbered), so it avoids the
// stale-offset fragility of unified diffs. A SEARCH that doesn't match (or
// matches ambiguously) is reported; the caller can fall back to a full rewrite
// when too many blocks fail.

export interface DiffBlock {
  search: string;
  replace: string;
}

export interface ApplyResult {
  source: string;
  applied: number;
  failed: { block: DiffBlock; reason: string }[];
}

const FENCE_SEARCH = "<<<<<<< SEARCH";
const FENCE_MID = "=======";
const FENCE_REPLACE = ">>>>>>> REPLACE";

export class DiffEngine {
  /** Parse SEARCH/REPLACE blocks out of an LLM response (tolerant of prose/fences). */
  static parse(text: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const lines = text.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      if (lines[i].trim() !== FENCE_SEARCH) {
        i++;
        continue;
      }
      i++;
      const search: string[] = [];
      while (i < lines.length && lines[i].trim() !== FENCE_MID) search.push(lines[i++]);
      if (i >= lines.length) break;
      i++; // skip divider
      const replace: string[] = [];
      while (i < lines.length && lines[i].trim() !== FENCE_REPLACE) replace.push(lines[i++]);
      if (i >= lines.length) break;
      i++; // skip closer
      blocks.push({ search: search.join("\n"), replace: replace.join("\n") });
    }
    return blocks;
  }

  /** Does `text` contain diff-block markers at all? (vs. a full-file rewrite) */
  static looksLikeDiff(text: string): boolean {
    return text.includes(FENCE_SEARCH) && text.includes(FENCE_REPLACE);
  }

  /**
   * Render source with right-aligned line numbers (`  12 | const x = 1`). A
   * reading aid for the prompt; SEARCH still matches on content, so the model
   * must NOT copy the `NN | ` prefix into SEARCH text.
   */
  static numberLines(source: string): string {
    const lines = source.split(/\r?\n/);
    const width = String(lines.length).length;
    return lines.map((l, i) => `${String(i + 1).padStart(width)} | ${l}`).join("\n");
  }

  /**
   * Apply diff blocks in order. Each SEARCH must occur exactly once; missing or
   * ambiguous matches fail that block (reported; others still apply). Exact
   * match first, then a trimmed-per-line fuzzy fallback for whitespace drift.
   */
  static apply(source: string, blocks: DiffBlock[]): ApplyResult {
    let current = source;
    let applied = 0;
    const failed: ApplyResult["failed"] = [];

    for (const block of blocks) {
      if (block.search === "") {
        failed.push({ block, reason: "empty SEARCH" });
        continue;
      }
      let idx = current.indexOf(block.search);
      let matchLen = block.search.length;

      if (idx === -1) {
        const found = DiffEngine.fuzzyFind(current, block.search);
        if (found) {
          idx = found.start;
          matchLen = found.end - found.start;
        }
      }
      if (idx === -1) {
        failed.push({ block, reason: "SEARCH text not found" });
        continue;
      }
      if (current.indexOf(block.search, idx + 1) !== -1) {
        failed.push({ block, reason: "SEARCH text is ambiguous (matches >1 site)" });
        continue;
      }
      current = current.slice(0, idx) + block.replace + current.slice(idx + matchLen);
      applied++;
    }
    return { source: current, applied, failed };
  }

  /** Whitespace-tolerant search: compare per-line trimmed windows, map back to offsets. */
  private static fuzzyFind(source: string, needle: string): { start: number; end: number } | null {
    const norm = (s: string) =>
      s
        .split(/\r?\n/)
        .map((l) => l.trim())
        .join("\n");
    const target = norm(needle);
    if (!target) return null;

    const srcLines = source.split(/\r?\n/);
    const needleLineCount = needle.split(/\r?\n/).length;
    const offsets: number[] = [];
    let acc = 0;
    for (const l of srcLines) {
      offsets.push(acc);
      acc += l.length + 1;
    }
    for (let s = 0; s + needleLineCount <= srcLines.length; s++) {
      const window = srcLines.slice(s, s + needleLineCount);
      if (norm(window.join("\n")) !== target) continue;
      const start = offsets[s];
      const lastLineIdx = s + needleLineCount - 1;
      const end = offsets[lastLineIdx] + srcLines[lastLineIdx].length;
      return { start, end };
    }
    return null;
  }
}
