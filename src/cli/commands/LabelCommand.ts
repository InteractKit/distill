import { Config } from "../../core/Config.js";
import { Labeler } from "../../core/Labeler.js";
import { Reporter } from "../../ui/Reporter.js";

// `distill label` - stage 1 only: data.txt → cache.jsonl (resumable).
export class LabelCommand {
  constructor(private readonly opts: { task?: string; relabel?: boolean }) {}

  async run(): Promise<void> {
    const cfg = await Config.load(this.opts.task);
    const r = new Reporter();

    r.banner("distill · label", "data.txt → cache.jsonl");
    r.note(
      `task ${cfg.rel(cfg.taskPath)} · ${cfg.labelProvider}:${cfg.labelModel}`,
    );

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
  }
}
