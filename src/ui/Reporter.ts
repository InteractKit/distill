import type { TagScore } from "../domain/types.js";

// ─── Reporter: all CLI presentation in one injectable object ─────────────────
// Colors auto-disable when stderr is not a TTY (piped to a file) so logs stay
// clean. A `silent` reporter (quiet=true) is used by `run`/`eval` so stdout
// stays pure for piping.

const BARS = " ▁▂▃▄▅▆▇█";

export class Reporter {
  private readonly color: boolean;

  constructor(private readonly quiet = false) {
    const isTTY = process.stderr.isTTY ?? false;
    this.color = isTTY && process.env.NO_COLOR === undefined;
  }

  /** True when stderr is an interactive terminal (enables in-place redraws). */
  private get isTTY(): boolean {
    return (process.stderr.isTTY ?? false) && !this.quiet;
  }

  private code(n: number, s: string): string {
    return this.color ? `\x1b[${n}m${s}\x1b[0m` : s;
  }

  // ── color helpers (public so commands can compose strings) ──
  bold = (s: string) => this.code(1, s);
  dim = (s: string) => this.code(2, s);
  red = (s: string) => this.code(31, s);
  green = (s: string) => this.code(32, s);
  yellow = (s: string) => this.code(33, s);
  blue = (s: string) => this.code(34, s);
  magenta = (s: string) => this.code(35, s);
  cyan = (s: string) => this.code(36, s);
  gray = (s: string) => this.code(90, s);

  private write(s: string): void {
    if (!this.quiet) process.stderr.write(s + "\n");
  }

  banner(title: string, subtitle?: string): void {
    // Cap width so a long subtitle (e.g. an absolute path) doesn't blow out the box.
    const w = Math.min(56, Math.max(title.length, subtitle?.length ?? 0)) + 4;
    const line = "─".repeat(w);
    this.write("");
    this.write(this.cyan("╭" + line + "╮"));
    this.write(this.cyan("│  ") + this.bold(title));
    if (subtitle) this.write(this.cyan("│  ") + this.dim(subtitle));
    this.write(this.cyan("╰" + line + "╯"));
  }

  step(n: number, total: number, label: string): void {
    this.write(`\n${this.magenta(this.bold(`[${n}/${total}]`))} ${this.bold(label)}`);
  }

  info = (s: string) => this.write(`  ${this.blue("ℹ")} ${s}`);
  ok = (s: string) => this.write(`  ${this.green("✔")} ${s}`);
  warn = (s: string) => this.write(`  ${this.yellow("⚠")} ${s}`);
  err = (s: string) => this.write(`  ${this.red("✘")} ${s}`);
  note = (s: string) => this.write(`    ${this.gray(s)}`);
  plain = (s: string) => this.write(s);

  /** A redraw-in-place progress bar (TTY) with a tick fallback when piped. */
  progress(total: number, label: string) {
    const self = this;
    let lastTick = -1;
    return {
      update(done: number, suffix = ""): void {
        if (self.quiet) return;
        if (self.isTTY) {
          const width = 24;
          const filled = Math.round((done / total) * width);
          const bar = self.green("█".repeat(filled)) + self.gray("░".repeat(width - filled));
          const pct = ((done / total) * 100).toFixed(0).padStart(3);
          process.stderr.write(`\r  ${label} ${bar} ${pct}% (${done}/${total}) ${self.dim(suffix)}   `);
        } else if (done !== lastTick && (done % 10 === 0 || done === total)) {
          self.write(`  ${label}: ${done}/${total} ${suffix}`);
          lastTick = done;
        }
      },
      done(suffix = ""): void {
        if (self.quiet) return;
        if (self.isTTY) process.stderr.write("\r" + " ".repeat(80) + "\r");
        self.ok(`${label} complete ${self.dim(suffix)}`);
      },
    };
  }

  /** Per-tag score table with an F1 sparkline. */
  scoreTable(perTag: TagScore[]): void {
    for (const s of perTag) {
      const spark = BARS[Math.min(8, Math.round(s.f1 * 8))];
      const col = s.f1 >= 0.85 ? this.green : s.f1 >= 0.6 ? this.yellow : this.red;
      this.write(
        `    ${this.bold(s.tag.padEnd(11))} ${col(spark)} F1 ${col(s.f1.toFixed(2))}  ` +
          this.dim(`P ${s.precision.toFixed(2)} R ${s.recall.toFixed(2)}  (tp${s.tp} fp${s.fp} fn${s.fn})`),
      );
    }
  }

  /** A delta arrow for score changes. */
  delta(before: number, after: number): string {
    const d = after - before;
    if (Math.abs(d) < 1e-6) return this.gray("→ no change");
    return d > 0 ? this.green(`▲ +${d.toFixed(3)}`) : this.red(`▼ ${d.toFixed(3)}`);
  }
}
