import { tool, stepCountIs } from "ai";
import { z } from "zod";
import type { LlmClient } from "./LlmClient.js";
import type { EvalReport, RowError } from "../domain/types.js";
import { PromptFactory } from "./PromptFactory.js";
import { FailureIndex } from "./FailureIndex.js";

// ─── RefineAgent: reads source on demand, returns diff blocks ────────────────
// The full file is NOT placed in the prompt. The model uses read_lines/grep
// tools to inspect only the windows it needs to anchor SEARCH blocks, then
// returns SEARCH/REPLACE diff text. Keeps prompts small while diffs still match
// verbatim because the model read the exact lines it edits.

export interface RefineOutcome {
  diffText: string;
  toolCalls: number;
  steps: number;
}

export class RefineAgent {
  constructor(private readonly llm: LlmClient) {}

  async propose(
    source: string,
    devReport: EvalReport,
    errors: RowError[],
    hardcodeWarnings: string[],
    maxErrors = 25,
  ): Promise<RefineOutcome> {
    const { system, user } = PromptFactory.refine({
      devReport,
      errors,
      hardcodeWarnings,
      maxErrors,
    });

    const totalLines = source.split(/\r?\n/).length;
    const failures = new FailureIndex(errors);
    let toolCalls = 0;

    const tools = {
      // ── diagnose the extractor's OWN mistakes ──
      failure_stats: tool({
        description:
          "See the SHAPE of the current errors: the most frequent spans the extractor tags WRONGLY (false positives) and MISSES (false negatives), optionally for one tag. Start here — one general rule often kills many same-span errors.",
        inputSchema: z.object({
          tag: z.string().optional().describe("Limit to one tag, e.g. 'COMPANY'. Omit for all."),
          top: z.number().int().min(1).max(50).optional().describe("How many top spans (default 15)."),
        }),
        execute: async ({ tag, top }) => {
          toolCalls++;
          const s = failures.stats({ tag, top });
          const fmt = (xs: { span: string; tag: string; count: number }[]) =>
            xs.map((x) => `${JSON.stringify(x.span)} [${x.tag}] ×${x.count}`).join("\n") || "(none)";
          return (
            `Totals${tag ? ` for ${tag}` : ""}: ${s.counts.fp} false positives, ${s.counts.fn} false negatives\n\n` +
            `WRONGLY TAGGED (false positives) — most frequent:\n${fmt(s.falsePositives)}\n\n` +
            `MISSED (false negatives) — most frequent:\n${fmt(s.falseNegatives)}`
          );
        },
      }),
      list_failures: tool({
        description:
          "Page through raw failing rows (the input sentence + what was missed/wrongly tagged), to see a span in context before writing a rule. Filter by tag/kind; use offset/nextOffset to page.",
        inputSchema: z.object({
          tag: z.string().optional().describe("Limit to rows involving this tag."),
          kind: z.enum(["fp", "fn"]).optional().describe("fp = wrong tags only, fn = misses only."),
          limit: z.number().int().min(1).max(50).optional().describe("Rows per page (default 20)."),
          offset: z.number().int().min(0).optional().describe("Start index (default 0)."),
        }),
        execute: async ({ tag, kind, limit, offset }) => {
          toolCalls++;
          const r = failures.list({ tag, kind, limit, offset });
          const body = r.rows
            .map((row) => {
              const miss = row.missed.map((x) => `[${x.text}](${x.tag})`).join(" ") || "-";
              const wrong = row.wrong.map((x) => `[${x.text}](${x.tag})`).join(" ") || "-";
              return `Input: ${row.input}\n  MISSED: ${miss}\n  WRONG: ${wrong}`;
            })
            .join("\n\n");
          const more = r.nextOffset !== null ? `\n\n(${r.total} total; next offset=${r.nextOffset})` : `\n\n(${r.total} total; end)`;
          return (body || "(no matching failures)") + more;
        },
      }),
      // ── inspect the source to write diffs ──
      read_lines: tool({
        description: `Read a line range of the current extractor source (1-based, inclusive). The file has ${totalLines} lines. Copy SEARCH text from this output (without the "NN| " prefix).`,
        inputSchema: z.object({
          start: z.number().int().min(1).describe("First line (1-based)."),
          end: z.number().int().min(1).describe("Last line (inclusive)."),
        }),
        execute: async ({ start, end }) => {
          toolCalls++;
          const capped = Math.min(end, start + 200); // cap a single window
          return RefineAgent.sliceLines(source, start, capped);
        },
      }),
      grep: tool({
        description: "Find line numbers whose text matches a substring or /regex/. Returns matching lines with numbers.",
        inputSchema: z.object({
          pattern: z.string().describe("Substring, or /regex/flags."),
        }),
        execute: async ({ pattern }) => {
          toolCalls++;
          return RefineAgent.grep(source, pattern);
        },
      }),
    };

    const { text, steps } = await this.llm.runWithTools({
      system,
      prompt: user,
      tools,
      // More steps than before: the agent now diagnoses failures AND reads source.
      stopWhen: stepCountIs(14),
    });

    return { diffText: text, toolCalls, steps };
  }

  /** Line-numbered slice for the read_lines tool result. */
  private static sliceLines(source: string, start: number, end: number): string {
    const lines = source.split(/\r?\n/);
    const s = Math.max(1, start);
    const e = Math.min(lines.length, end);
    const width = String(e).length;
    const body = lines
      .slice(s - 1, e)
      .map((l, i) => `${String(s + i).padStart(width)}| ${l}`)
      .join("\n");
    return `[lines ${s}-${e} of ${lines.length}]\n${body}`;
  }

  /** Substring or /regex/ search returning numbered hits. */
  private static grep(source: string, pattern: string): string {
    const lines = source.split(/\r?\n/);
    let test: (s: string) => boolean;
    const m = pattern.match(/^\/(.*)\/([a-z]*)$/);
    try {
      test = m ? (s) => new RegExp(m[1], m[2]).test(s) : (s) => s.includes(pattern);
    } catch {
      test = (s) => s.includes(pattern);
    }
    const hits = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => test(x.l))
      .slice(0, 40)
      .map((x) => `${x.n}| ${x.l}`);
    return hits.length ? hits.join("\n") : "(no matches)";
  }
}
