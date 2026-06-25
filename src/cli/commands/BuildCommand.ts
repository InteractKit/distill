import { Config } from "../../core/Config.js";
import { Labeler } from "../../core/Labeler.js";
import { Corpus } from "../../core/Corpus.js";
import { Synthesizer } from "../../core/Synthesizer.js";
import { Reporter } from "../../ui/Reporter.js";

// `distill build` - full pipeline: label (cached) → synth loop → write extractor.
export class BuildCommand {
  constructor(
    private readonly opts: { task?: string; relabel?: boolean; fresh?: boolean },
  ) {}

  async run(): Promise<void> {
    const t0 = process.hrtime.bigint();
    const cfg = await Config.load(this.opts.task);
    const r = new Reporter();

    r.banner("distill · build", "label → learn → generate a code extractor");
    r.note(`task    ${cfg.rel(cfg.taskPath)}`);
    r.note(
      `data    ${cfg.rel(cfg.dataPath)}  →  cache ${cfg.rel(cfg.cachePath)}  →  code ${cfg.rel(cfg.outputPath)}`,
    );
    r.note(
      `label   ${cfg.labelProvider}:${cfg.labelModel}    synth  ${cfg.synthProvider}:${cfg.synthModel} (${cfg.rounds} rounds)`,
    );

    // ── Stage 1: label ──
    r.step(1, 2, "Labeling corpus");
    const labeler = new Labeler(cfg, r);
    if (this.opts.relabel) {
      r.warn("--relabel: clearing cache.jsonl and re-labeling from scratch");
      await labeler.reset();
    }
    const { rows, stats } = await labeler.ensure();
    r.ok(
      `corpus ready · ${r.bold(String(rows.length))} rows · ${stats.entities} gold entities · ` +
        `avg ${(stats.entities / Math.max(1, rows.length)).toFixed(1)}/row`,
    );
    if (rows.length === 0)
      throw new Error(`No labeled rows. Is ${cfg.rel(cfg.dataPath)} empty?`);

    // ── Stage 2: synthesize ──
    r.step(2, 2, "Synthesizing extractor code");
    const corpus = new Corpus(rows, {
      trainFrac: cfg.trainFrac,
      devFrac: cfg.devFrac,
    });
    const result = await new Synthesizer(cfg, r).run(corpus, {
      fresh: this.opts.fresh ?? false,
    });

    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    r.banner("done", `${secs.toFixed(1)}s`);
    r.ok(`output code   ${r.bold(cfg.rel(cfg.outputPath))}`);
    r.plain(
      `  ${r.green("dev  F1")}  ${r.bold(result.bestDevMicroF1.toFixed(3))}`,
    );
    r.plain(
      `  ${r.blue("test F1")}  ${r.bold(result.finalTestMicroF1.toFixed(3))}   ${r.dim("(held-out, scored once)")}`,
    );
    const gapBad = result.devTestGap > 0.15;
    r.plain(
      `  ${gapBad ? r.red("gap    ") : r.gray("gap    ")} ${result.devTestGap.toFixed(3)}` +
        (gapBad
          ? r.red("  ⚠ memorizing - add more data")
          : r.dim("  ✓ generalizing")),
    );
  }
}
