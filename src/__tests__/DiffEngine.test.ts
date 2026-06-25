// Standalone assertions for DiffEngine (run: npm run test).
import { DiffEngine } from "../core/DiffEngine.js";

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

const SRC = `function extract(text, store) {
  const out = [];
  // tag YEARS
  for (const m of text.matchAll(/\\d+ years/g)) out.push({ text: m[0], tag: "YEARS" });
  return out;
}`;

// 1. parse a single block
{
  const blocks = DiffEngine.parse(`<<<<<<< SEARCH
  return out;
=======
  out.sort();
  return out;
>>>>>>> REPLACE`);
  check("parse single block", blocks.length === 1 && blocks[0].search === "  return out;");
}

// 2. apply exact-match block
{
  const blocks = DiffEngine.parse(`<<<<<<< SEARCH
  return out;
=======
  out.sort();
  return out;
>>>>>>> REPLACE`);
  const res = DiffEngine.apply(SRC, blocks);
  check("apply exact match", res.applied === 1 && res.source.includes("out.sort();"), JSON.stringify(res.failed));
}

// 3. not-found block reported, source intact
{
  const res = DiffEngine.apply(SRC, [{ search: "this text does not exist", replace: "x" }]);
  check("not-found reported", res.applied === 0 && res.failed[0].reason === "SEARCH text not found");
  check("not-found leaves source intact", res.source === SRC);
}

// 4. ambiguous refused
{
  const dup = "const out = [];\nconst out = [];";
  const res = DiffEngine.apply(dup, [{ search: "const out = [];", replace: "const out = {};" }]);
  check("ambiguous refused", res.applied === 0 && res.failed[0].reason.includes("ambiguous"));
}

// 5. fuzzy whitespace match
{
  const res = DiffEngine.apply(SRC, [{ search: "return out;", replace: "return out.reverse();" }]);
  check("fuzzy whitespace match", res.applied === 1 && res.source.includes("out.reverse()"), JSON.stringify(res.failed));
}

// 6. multiple blocks in order
{
  const res = DiffEngine.apply(
    SRC,
    DiffEngine.parse(`<<<<<<< SEARCH
  const out = [];
=======
  const out = []; // accumulator
>>>>>>> REPLACE
<<<<<<< SEARCH
  return out;
=======
  return out.filter(Boolean);
>>>>>>> REPLACE`),
  );
  check("multi-block apply", res.applied === 2 && res.source.includes("accumulator") && res.source.includes("filter(Boolean)"));
}

// 7. parse amid prose/fences
{
  const blocks = DiffEngine.parse(`Sure, here are my edits:
\`\`\`
<<<<<<< SEARCH
  return out;
=======
  return [...out];
>>>>>>> REPLACE
\`\`\`
Hope that helps!`);
  check("parse amid prose", blocks.length === 1 && blocks[0].replace === "  return [...out];");
}

// 8. looksLikeDiff discriminates
{
  check("looksLikeDiff true", DiffEngine.looksLikeDiff(SRC + "\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE"));
  check("looksLikeDiff false", !DiffEngine.looksLikeDiff("function extract() { return []; }"));
}

// 9. numberLines format
{
  const n = DiffEngine.numberLines("a\nb");
  check("numberLines", n === "1 | a\n2 | b", JSON.stringify(n));
}

console.log(`\n${failed === 0 ? "✓ all" : "✗"} DiffEngine tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
