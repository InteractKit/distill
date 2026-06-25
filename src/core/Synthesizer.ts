import { dirname, join, basename } from "node:path";
import type { Config } from "./Config.js";
import type { Corpus } from "./Corpus.js";
import type { Reporter } from "../ui/Reporter.js";
import { LabelStore } from "./LabelStore.js";
import { Evaluator } from "./Evaluator.js";
import { ExtractorModule } from "./ExtractorModule.js";
import { ExtractorBundler } from "./ExtractorBundler.js";
import { Champion } from "./Champion.js";
import { LlmClient } from "./LlmClient.js";
import { RefineAgent } from "./RefineAgent.js";
import { DiffEngine } from "./DiffEngine.js";
import { PromptFactory } from "./PromptFactory.js";
import { Population, type Candidate } from "./Population.js";
import type { GeneratedExtractor, LabeledRow } from "../domain/types.js";

export interface SynthResult {
  bestSource: string;
  bestDevMicroF1: number;
  finalTestMicroF1: number;
  devTestGap: number;
  history: { round: number; devF1: number; testF1: number; gap: number }[];
}

// ─── Synthesizer: population-based build loop ────────────────────────────────
// size 1  → seed one extractor, mutate it each round (greedy hill-climb).
// size N  → seed N diverse drafts; each generation: mutate survivors + crossover
//           pairs, score on DEV, then niche-select back to N distinct survivors.
// TEST is reported (gap), never used to pick - selecting on test would leak it.
// The LabelStore is train-only, so neither the code nor the loop can read answers.
export class Synthesizer {
  private readonly llm: LlmClient;
  private candCounter = 0;
  // Per-candidate temp modules (own file each) so parallel scoring never clobbers.
  private readonly modules = new Map<string, ExtractorModule>();

  // Set in run(): the live train-only knowledge + scorer + refiner.
  private store!: LabelStore;
  private evaluator!: Evaluator;
  private refiner!: RefineAgent;
  private devRows!: LabeledRow[];
  private testRows!: LabeledRow[];

  constructor(
    private readonly cfg: Config,
    private readonly reporter: Reporter,
  ) {
    this.llm = new LlmClient(
      cfg.synthProvider,
      cfg.synthModel,
      cfg.synthTemperature,
    );
  }

  /** Scratch dir for per-candidate temp modules: `.distills/` beside the output. */
  private get tempDir(): string {
    return join(dirname(this.cfg.outputPath), ".distills");
  }

  /** Temp file path for a candidate, inside the `.distills/` scratch dir. */
  private candPath(id: string): string {
    // e.g. output "extractor.gen.ts" → ".distills/extractor.gen.c0.ts"
    const name = basename(this.cfg.outputPath).replace(
      /(\.[^.]+)?$/,
      `.${id}$1`,
    );
    return join(this.tempDir, name);
  }

  /**
   * Raw source to warm-start gen 0 from, or null to start fresh. Reads the
   * champion sidecar saved by the previous build; ignored if its tag set no
   * longer matches the config (the prior code would target stale tags).
   */
  private async warmStartSource(): Promise<{
    source: string;
    devMicroF1: number;
  } | null> {
    const meta = await Champion.load(this.cfg.outputPath);
    if (!meta) return null;
    if (!Champion.tagsMatch(meta.tags, this.cfg.tagNames)) {
      this.reporter.note(
        "existing extractor was built for a different tag set - starting fresh",
      );
      return null;
    }
    return { source: meta.source, devMicroF1: meta.devMicroF1 };
  }

  async run(
    corpus: Corpus,
    opts: { fresh?: boolean } = {},
  ): Promise<SynthResult> {
    const r = this.reporter;
    const { train, dev, test } = corpus.partition();
    if (train.length === 0) throw new Error("no train rows after split");

    this.devRows = dev.length ? dev : train;
    this.testRows = test.length ? test : train;
    r.info(
      `split → ${r.green(`train ${train.length}`)} · ${r.yellow(`dev ${dev.length}`)} · ${r.blue(`test ${test.length}`)}`,
    );
    if (!dev.length)
      r.warn(
        "dev slice is empty (tiny dataset) - scoring against train as a fallback",
      );

    // Scratch dir for the per-candidate temp modules written during the loop.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.tempDir, { recursive: true });

    this.store = LabelStore.fromTrain(train);
    // Score only the configured tags — keeps the report clean even if the cache
    // happens to contain stray tags from older runs.
    this.evaluator = new Evaluator(this.store, this.cfg.tagNames);
    this.refiner = new RefineAgent(this.llm);

    const pc = this.cfg.population;
    r.note(
      `population: size ${pc.size} · survivors ${pc.survivors} · ${pc.diversity}` +
        (pc.crossover ? " · crossover on" : "") +
        ` · LabelStore train-only (${this.store.tags.length} tags)`,
    );

    const examples = train
      .slice(0, 6)
      .map((x) => ({ input: x.input, entities: x.entities }));
    const history: SynthResult["history"] = [];
    const pop = new Population(pc);

    // ── Generation 0: warm-start from the prior extractor, else fresh drafts ──
    // A previous build saved its champion's raw source to a sidecar. If it's
    // present, still valid for these tags, and the user didn't pass --fresh, we
    // seed one slot from it so NEW DATA IMPROVES the existing extractor instead
    // of rebuilding from scratch. Any remaining population slots are fresh,
    // diverse drafts (so size>1 keeps exploring).
    const warm = opts.fresh ? null : await this.warmStartSource();

    if (warm) {
      const cand = await this.makeCandidate(warm.source, "warm-start");
      if (cand) {
        pop.add(cand);
        r.info(
          `warm-start from existing extractor ${r.dim(`(prior dev F1 ${warm.devMicroF1.toFixed(3)})`)} → re-scored dev F1 ${r.bold(cand.dev.microF1.toFixed(3))}`,
        );
      } else {
        r.warn("existing extractor failed to compile - seeding fresh instead");
      }
    }

    const freshNeeded = pc.size - pop.size;
    if (freshNeeded > 0) {
      r.info(
        `seeding ${r.bold(String(freshNeeded))} draft(s) with ${r.bold(`${this.cfg.synthProvider}:${this.cfg.synthModel}`)} …`,
      );
    }
    for (let i = 0; i < freshNeeded; i++) {
      const variant =
        PromptFactory.SEED_VARIANTS[i % PromptFactory.SEED_VARIANTS.length];
      const gen = PromptFactory.generate({
        tags: this.cfg.tags,
        instruction: this.cfg.instruction,
        storeSummary: this.store.describe(),
        examples,
        variantHint: pc.size > 1 ? variant.hint : undefined,
      });
      const source = await this.llm.complete(gen.system, gen.user);
      const cand = await this.makeCandidate(
        source,
        pc.size > 1 ? `seed:${variant.key}` : "seed",
      );
      if (cand) {
        pop.add(cand);
        r.note(
          `  ${cand.id} (${cand.origin}) dev F1 ${cand.dev.microF1.toFixed(3)}`,
        );
      }
    }
    if (pop.size === 0) throw new Error("all seed drafts failed to compile");

    this.reportGeneration(r, history, 0, pop);
    pop.select(this.store.tags);

    // ── Generations 1..rounds ──
    for (let round = 1; round <= this.cfg.rounds; round++) {
      const breeders = pop.breeders();
      const children: Candidate[] = [];

      // Mutate each breeder (agentic diff refine).
      for (const parent of breeders) {
        const child = await this.mutate(parent, r);
        if (child) children.push(child);
      }

      // Crossover the top two breeders (combine per-tag strengths).
      if (pc.crossover && breeders.length >= 2) {
        const child = await this.crossover(breeders[0], breeders[1], r);
        if (child) children.push(child);
      }

      for (const c of children) pop.add(c);

      this.reportGeneration(r, history, round, pop);

      // Niche-select back to `size` distinct survivors.
      const survivors = pop.select(this.store.tags);
      if (pc.size > 1) {
        r.note(
          `survivors: ${survivors.map((s) => `${s.id}(${s.dev.microF1.toFixed(2)})`).join(", ")}`,
        );
      }

      // Early stop: best has no dev errors left.
      if (
        this.evaluator.errors(await this.load(pop.best()), this.devRows)
          .length === 0
      ) {
        r.ok("best candidate has no dev errors - converged early 🎉");
        break;
      }
    }

    // Ship the best-on-dev candidate to the configured output path - bundled
    // into a self-contained file that carries its own train-only knowledge, so
    // it runs anywhere with no package or cache dependency.
    const champ = pop.best();
    const bundled = ExtractorBundler.bundle(champ.source, this.store);
    await new ExtractorModule(this.cfg.outputPath).write(bundled);
    // Persist the raw champion so the NEXT build can warm-start from it
    // (improve this extractor) instead of synthesizing from scratch.
    await Champion.save(this.cfg.outputPath, {
      source: champ.source,
      tags: this.cfg.tagNames,
      devMicroF1: champ.dev.microF1,
    });
    await this.cleanupTempFiles();

    return {
      bestSource: champ.source,
      bestDevMicroF1: champ.dev.microF1,
      finalTestMicroF1: champ.test.microF1,
      devTestGap: champ.dev.microF1 - champ.test.microF1,
      history,
    };
  }

  // ── candidate lifecycle ──

  /** Compile + score a source into a Candidate (or null if it doesn't compile). */
  private async makeCandidate(
    source: string,
    origin: string,
  ): Promise<Candidate | null> {
    const id = `c${this.candCounter++}`;
    const mod = new ExtractorModule(this.candPath(id));
    this.modules.set(id, mod);
    let extractor: GeneratedExtractor;
    try {
      extractor = await mod.writeAndLoad(source);
    } catch {
      return null;
    }
    const dev = this.evaluator.score(extractor, this.devRows, "dev");
    const test = this.evaluator.score(extractor, this.testRows, "test");
    return { id, source, dev, test, origin };
  }

  private async load(c: Candidate): Promise<GeneratedExtractor> {
    const mod =
      this.modules.get(c.id) ?? new ExtractorModule(this.candPath(c.id));
    return mod.writeAndLoad(c.source);
  }

  /** Agentic diff-refine of one parent → a scored child. */
  private async mutate(
    parent: Candidate,
    r: Reporter,
  ): Promise<Candidate | null> {
    const errors = this.evaluator.errors(await this.load(parent), this.devRows);
    if (errors.length === 0) return null;
    const warnings = ExtractorModule.detectHardcodedLiterals(parent.source);
    if (warnings.length)
      r.warn(
        `${parent.id}: hardcoded-literal smell: ${warnings.slice(0, 2).join(", ")}`,
      );

    try {
      const { diffText, toolCalls } = await this.refiner.propose(
        parent.source,
        parent.dev,
        errors,
        warnings,
      );
      if (!DiffEngine.looksLikeDiff(diffText)) return null;
      const res = DiffEngine.apply(parent.source, DiffEngine.parse(diffText));
      if (res.applied === 0) return null;
      const child = await this.makeCandidate(
        res.source,
        `mutate(${parent.id})`,
      );
      if (child) {
        r.note(
          `mutate ${parent.id}→${child.id}  ${r.delta(parent.dev.microF1, child.dev.microF1)} ` +
            r.dim(`(${toolCalls} reads, ${res.applied} diffs)`),
        );
      }
      return child;
    } catch (e) {
      r.warn(`mutate ${parent.id} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Combine two parents' per-tag strengths → a scored child. */
  private async crossover(
    a: Candidate,
    b: Candidate,
    r: Reporter,
  ): Promise<Candidate | null> {
    try {
      const { system, user } = PromptFactory.crossover({
        parentA: { source: a.source, perTag: a.dev.perTag },
        parentB: { source: b.source, perTag: b.dev.perTag },
      });
      const source = await this.llm.complete(system, user);
      const child = await this.makeCandidate(source, `x(${a.id}×${b.id})`);
      if (child) {
        const parentBest = Math.max(a.dev.microF1, b.dev.microF1);
        r.note(
          `crossover ${a.id}×${b.id}→${child.id}  ${r.delta(parentBest, child.dev.microF1)}`,
        );
      }
      return child;
    } catch (e) {
      r.warn(`crossover ${a.id}×${b.id} failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ── reporting ──
  private reportGeneration(
    r: Reporter,
    history: SynthResult["history"],
    round: number,
    pop: Population,
  ): void {
    const best = pop.best();
    const gap = best.dev.microF1 - best.test.microF1;
    history.push({
      round,
      devF1: best.dev.microF1,
      testF1: best.test.microF1,
      gap,
    });

    const tag = round === 0 ? "gen 0 (seed)" : `gen ${round}`;
    r.plain(
      `\n${r.magenta(r.bold(`◆ ${tag}`))}  best dev F1 ${r.bold(best.dev.microF1.toFixed(3))} ${r.dim(`[${best.id} ${best.origin}]`)}  ` +
        r.dim(
          `· test F1 ${best.test.microF1.toFixed(3)} · gap ${gap.toFixed(3)}`,
        ) +
        (gap > 0.15 ? r.red("  ⚠ overfitting") : ""),
    );
    r.scoreTable(best.dev.perTag);
  }

  /** Remove the `.distills/` scratch dir (best already shipped to outputPath). */
  private async cleanupTempFiles(): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
