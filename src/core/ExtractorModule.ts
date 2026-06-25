import { writeFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { GeneratedExtractor } from "../domain/types.js";

// ─── ExtractorModule: write + import the generated extractor code ────────────
// Bound to one file path (from Config). Used by `build` (write/iterate),
// `run`, and `host` (load an existing artifact).
//
// The generated extractor is TypeScript. Plain Node can't import `.ts`, and the
// installed CLI runs under plain Node - so we load it through tsx's programmatic
// loader (`tsImport`), which transpiles on the fly AND re-evaluates fresh on each
// call (so a rebuilt extractor is picked up without a stale module cache).

export class ExtractorModule {
  constructor(readonly filePath: string) {}

  /** Write source to disk and import its `extract` export. */
  async writeAndLoad(source: string): Promise<GeneratedExtractor> {
    await writeFile(this.filePath, source, "utf8");
    return this.load();
  }

  /** Just write source (no import). */
  async write(source: string): Promise<void> {
    await writeFile(this.filePath, source, "utf8");
  }

  /** Read the current source from disk. */
  async read(): Promise<string> {
    return readFile(this.filePath, "utf8");
  }

  /** Import the current file's `extract` export (fresh each call). */
  async load(): Promise<GeneratedExtractor> {
    const { tsImport } = await import("tsx/esm/api");
    const mod = (await tsImport(
      pathToFileURL(this.filePath).href,
      import.meta.url,
    )) as {
      extract?: unknown;
    };
    if (typeof mod.extract !== "function") {
      throw new Error("generated module does not export a function `extract`");
    }
    return mod.extract as GeneratedExtractor;
  }

  /**
   * Flag suspiciously specific string-literal comparisons against full
   * entity-looking values (the optimizer cheating by memorizing eval answers).
   * Not airtight, but catches the obvious `text.includes("Priya Nair")` pattern.
   */
  static detectHardcodedLiterals(source: string): string[] {
    const offenders: string[] = [];
    const re =
      /\.(?:includes|indexOf|startsWith|endsWith)\(\s*(["'])((?:[A-Z][\w.+#-]*\s+){1,}[A-Z][\w.+#-]*)\1/g;
    for (const m of source.matchAll(re)) offenders.push(m[2]);
    return offenders;
  }
}
