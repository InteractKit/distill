// Assertions for FailureIndex (run via `npm test`).
import { FailureIndex } from "../core/FailureIndex.js";
import type { RowError } from "../domain/types.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name} ${extra}`);
  }
}

const fp = (text: string, tag: string) => ({ text, tag });
const errors: RowError[] = [
  { input: "the Apple thing", gold: [], predicted: [], falsePos: [fp("the", "COMPANY"), fp("Inc", "COMPANY")], falseNeg: [fp("Apple", "COMPANY")] },
  { input: "the other Inc", gold: [], predicted: [], falsePos: [fp("the", "COMPANY"), fp("Inc", "COMPANY")], falseNeg: [] },
  { input: "missed one", gold: [], predicted: [], falsePos: [fp("the", "COMPANY")], falseNeg: [fp("Dow Jones Industrial Average", "INDEX")] },
];

const idx = new FailureIndex(errors);

// 1. stats aggregates false positives by frequency
{
  const s = idx.stats({ tag: "COMPANY" });
  const top = s.falsePositives[0];
  check("top FP span is 'the' ×3", top.span === "the" && top.count === 3, JSON.stringify(top));
  check("FP total counted", s.counts.fp === 5, String(s.counts.fp));
}

// 2. multi-word FN span kept intact (no splitting)
{
  const s = idx.stats({ tag: "INDEX" });
  check(
    "multi-word FN span intact",
    s.falseNegatives[0]?.span === "Dow Jones Industrial Average",
    JSON.stringify(s.falseNegatives),
  );
}

// 3. pagination
{
  const p1 = idx.list({ limit: 2, offset: 0 });
  check("page 1 returns 2 rows", p1.rows.length === 2 && p1.total === 3);
  check("nextOffset set", p1.nextOffset === 2);
  const p2 = idx.list({ limit: 2, offset: 2 });
  check("page 2 returns last row, end", p2.rows.length === 1 && p2.nextOffset === null);
}

// 4. filter by tag + kind
{
  const onlyFn = idx.list({ kind: "fn", tag: "INDEX" });
  check("filter fn+INDEX → 1 row", onlyFn.total === 1 && onlyFn.rows[0].input === "missed one");
}

console.log(`\n${failed === 0 ? "✓ all" : "✗"} FailureIndex tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
