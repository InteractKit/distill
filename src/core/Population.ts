import type { EvalReport } from "../domain/types.js";
import type { PopulationConfig } from "./Config.js";

// ─── Population: a set of candidate extractors with diversity-preserving selection ─
// The point of a population (vs. a single hill-climb) is to escape local optima.
// The point of *niching* is to keep the candidates genuinely DISTINCT: plain
// top-K selection collapses to one lineage within a few generations, so "size 4"
// would mean "4 near-copies." Per-tag niching instead keeps the best specialist
// for each tag plus an overall generalist, so each survivor occupies a different
// behavioral niche - which is exactly what crossover needs to combine strengths.

export interface Candidate {
  id: string;
  source: string;
  dev: EvalReport;
  test: EvalReport;
  /** Short provenance for logs, e.g. "seed:regex-first", "mutate(c0)", "x(c1×c2)". */
  origin: string;
}

export class Population {
  private members: Candidate[] = [];

  constructor(private readonly cfg: PopulationConfig) {}

  get size(): number {
    return this.members.length;
  }
  all(): readonly Candidate[] {
    return this.members;
  }

  add(c: Candidate): void {
    this.members.push(c);
  }

  /** The single best candidate by dev micro-F1 (the artifact we ship). */
  best(): Candidate {
    return [...this.members].sort((a, b) => b.dev.microF1 - a.dev.microF1)[0];
  }

  /** Candidates chosen to breed next generation (top `survivors` by dev F1). */
  breeders(): Candidate[] {
    return [...this.members]
      .sort((a, b) => b.dev.microF1 - a.dev.microF1)
      .slice(0, this.cfg.survivors);
  }

  /**
   * Reduce the population back to `size` survivors using the configured strategy.
   * Mutates in place and returns the survivors (for logging).
   */
  select(allTags: string[]): Candidate[] {
    const survivors =
      this.cfg.diversity === "top-k" ? this.topK() : this.perTagNiche(allTags);
    this.members = survivors;
    return survivors;
  }

  /** Plain truncation: the `size` highest dev-F1 candidates. */
  private topK(): Candidate[] {
    return [...this.members]
      .sort((a, b) => b.dev.microF1 - a.dev.microF1)
      .slice(0, this.cfg.size);
  }

  /**
   * Niche selection. Build up to `size` slots:
   *   - one generalist slot: best overall dev micro-F1,
   *   - then specialist slots: best per-tag F1 for the highest-support tags,
   * de-duplicated (a candidate can only fill one slot), padded with the next
   * best overall candidates if niches don't fill all `size` slots.
   */
  private perTagNiche(allTags: string[]): Candidate[] {
    const chosen = new Map<string, Candidate>(); // id → candidate

    // 1. generalist
    const generalist = this.best();
    if (generalist) chosen.set(generalist.id, generalist);

    // 2. per-tag specialists, tags ordered by total support (tp+fn) desc so the
    //    most informative tags get their own niche when slots are scarce.
    const support = (tag: string) =>
      this.members.reduce((acc, m) => {
        const s = m.dev.perTag.find((t) => t.tag === tag);
        return acc + (s ? s.tp + s.fn : 0);
      }, 0);
    const orderedTags = [...allTags].sort((a, b) => support(b) - support(a));

    for (const tag of orderedTags) {
      if (chosen.size >= this.cfg.size) break;
      const champ = this.bestForTag(tag);
      if (champ && !chosen.has(champ.id)) chosen.set(champ.id, champ);
    }

    // 3. pad with next-best overall if niches under-filled the slots.
    if (chosen.size < this.cfg.size) {
      for (const c of [...this.members].sort(
        (a, b) => b.dev.microF1 - a.dev.microF1,
      )) {
        if (chosen.size >= this.cfg.size) break;
        if (!chosen.has(c.id)) chosen.set(c.id, c);
      }
    }
    return [...chosen.values()];
  }

  /** The candidate with the highest F1 on a given tag (ties → higher overall). */
  private bestForTag(tag: string): Candidate | null {
    let best: { c: Candidate; f1: number } | null = null;
    for (const c of this.members) {
      const s = c.dev.perTag.find((t) => t.tag === tag);
      const f1 = s?.f1 ?? 0;
      if (
        !best ||
        f1 > best.f1 ||
        (f1 === best.f1 && c.dev.microF1 > best.c.dev.microF1)
      ) {
        best = { c, f1 };
      }
    }
    return best?.c ?? null;
  }
}
