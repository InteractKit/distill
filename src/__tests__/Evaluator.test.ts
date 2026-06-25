// Assertions for Evaluator (run via `npm test`).
import { Evaluator } from "../core/Evaluator.js";
import { LabelStore } from "../core/LabelStore.js";
import type { GeneratedExtractor, LabeledRow } from "../domain/types.js";

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

const store = LabelStore.fromTrain([]); // extractor below ignores it

// 1. Multi-word spans must NOT leak words as fake tags (regression test).
{
  const rows: LabeledRow[] = [
    { input: "Dow Jones Industrial Average rose.", entities: [{ text: "Dow Jones Industrial Average", tag: "INDEX" }] },
  ];
  const empty: GeneratedExtractor = () => [];
  const rep = new Evaluator(store).score(empty, rows, "dev");
  const tags = rep.perTag.map((t) => t.tag).sort();
  check("multi-word span tallies under its real tag only", tags.length === 1 && tags[0] === "INDEX", JSON.stringify(tags));
  check("the missed span is a false negative", rep.perTag[0].fn === 1 && rep.perTag[0].tp === 0);
}

// 2. validTags filters gold + predicted to the configured set.
{
  const rows: LabeledRow[] = [
    { input: "Apple beat.", entities: [{ text: "Apple", tag: "COMPANY" }, { text: "beat", tag: "JUNK" }] },
  ];
  const empty: GeneratedExtractor = () => [];
  const rep = new Evaluator(store, ["COMPANY"]).score(empty, rows, "dev");
  const tags = rep.perTag.map((t) => t.tag);
  check("validTags drops non-configured gold tags", tags.length === 1 && tags[0] === "COMPANY", JSON.stringify(tags));
}

// 3. Exact tp/fp/fn on a simple case.
{
  const rows: LabeledRow[] = [
    { input: "Apple and Tesla.", entities: [{ text: "Apple", tag: "COMPANY" }, { text: "Tesla", tag: "COMPANY" }] },
  ];
  // predict Apple (tp) + Ford (fp); miss Tesla (fn)
  const ex: GeneratedExtractor = () => [{ text: "Apple", tag: "COMPANY" }, { text: "Ford", tag: "COMPANY" }];
  const s = new Evaluator(store).score(ex, rows, "dev").perTag[0];
  check("tp/fp/fn correct", s.tp === 1 && s.fp === 1 && s.fn === 1, JSON.stringify(s));
}

console.log(`\n${failed === 0 ? "✓ all" : "✗"} Evaluator tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
