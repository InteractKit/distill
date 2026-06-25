import { writeFile } from "node:fs/promises";
import type { GoldEntity } from "../../domain/types.js";
import { Config } from "../../core/Config.js";
import { ExtractorModule } from "../../core/ExtractorModule.js";
import { InputSource, type InputRecord } from "../../core/InputSource.js";
import { Reporter } from "../../ui/Reporter.js";

// `distill run` - apply the BUILT extractor to new input. Pure code, no LLM.
//   input : --in FILE (.jsonl {text,id?} or .txt lines), else stdin (lines)
//   output: --out FILE, else stdout - JSONL of { id?, input, entities }
//           (id is carried through from input rows that have one)
//
// The shipped extractor is self-contained: it bundles its own train-only
// knowledge, so `extract(text)` runs with no store and no cache to reconstruct.
export class RunCommand {
  constructor(
    private readonly opts: { task?: string; in?: string; out?: string },
  ) {}

  async run(): Promise<void> {
    const cfg = await Config.load(this.opts.task);
    // Reporter is silent so stdout stays pure for piping; status goes to stderr.
    const r = new Reporter(false);

    const module = new ExtractorModule(cfg.outputPath);
    let extract;
    try {
      extract = await module.load();
    } catch {
      throw new Error(
        `No built extractor at ${cfg.rel(cfg.outputPath)} - run \`distill build\` first.`,
      );
    }

    const records = await this.readInput();
    const out: string[] = [];
    for (const rec of records) {
      let entities: GoldEntity[];
      try {
        // The bundled extractor supplies its own store; call it standalone.
        entities = extract(rec.text) ?? [];
      } catch {
        entities = [];
      }
      // Carry id through when present; output shape: { id?, input, entities }.
      const row =
        rec.id !== undefined
          ? { id: rec.id, input: rec.text, entities }
          : { input: rec.text, entities };
      out.push(JSON.stringify(row));
    }
    const jsonl = out.join("\n") + (out.length ? "\n" : "");

    if (this.opts.out) {
      await writeFile(this.opts.out, jsonl, "utf8");
      r.ok(`wrote ${out.length} records → ${this.opts.out}`);
    } else {
      process.stdout.write(jsonl);
    }
  }

  /** Records from --in file (format by extension), or stdin if not a TTY. */
  private async readInput(): Promise<InputRecord[]> {
    if (this.opts.in) return InputSource.fromFile(this.opts.in);
    if (!process.stdin.isTTY) return InputSource.fromStdin();
    throw new Error("No input: pass --in FILE or pipe text via stdin.");
  }
}
