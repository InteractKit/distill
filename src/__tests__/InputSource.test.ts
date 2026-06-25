// Assertions for InputSource (run: npx tsx src/core/InputSource.test.ts).
import { InputSource } from "../core/InputSource.js";

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

// 1. JSONL {text}
{
  const r = InputSource.parseJsonl(`{"text":"hello"}\n{"text":"world"}`);
  check("jsonl text", r.length === 2 && r[0].text === "hello" && r[1].text === "world");
}
// 2. JSONL {text,id} carries id (stringified)
{
  const r = InputSource.parseJsonl(`{"id":"a1","text":"x"}\n{"id":7,"text":"y"}`);
  check("jsonl id passthrough", r[0].id === "a1" && r[1].id === "7");
}
// 3. bare JSON string accepted
{
  const r = InputSource.parseJsonl(`"just text"`);
  check("jsonl bare string", r.length === 1 && r[0].text === "just text" && r[0].id === undefined);
}
// 4. blank lines skipped
{
  const r = InputSource.parseJsonl(`{"text":"a"}\n\n  \n{"text":"b"}`);
  check("jsonl skips blanks", r.length === 2);
}
// 5. invalid JSON line → error with line number
{
  let msg = "";
  try {
    InputSource.parseJsonl(`{"text":"ok"}\nnot json`);
  } catch (e) {
    msg = (e as Error).message;
  }
  check("jsonl invalid line errors", msg.includes("line 2"), msg);
}
// 6. object without text → error
{
  let msg = "";
  try {
    InputSource.parseJsonl(`{"foo":"bar"}`);
  } catch (e) {
    msg = (e as Error).message;
  }
  check("jsonl missing text errors", msg.includes("line 1"), msg);
}
// 7. plain .txt lines (no ids)
{
  const r = InputSource.parseLines(`one\n  two  \n\nthree`);
  check("txt lines", r.length === 3 && r[1].text === "two" && r[1].id === undefined);
}

console.log(`\n${failed === 0 ? "✓ all" : "✗"} InputSource tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
