import { readFile } from "node:fs/promises";

// ─── InputSource: one reader for raw inputs, shared by Labeler and `run` ──────
// Keeps the input format consistent across the pipeline. Each record is
// { text, id? }. Formats accepted:
//   - .jsonl : one JSON object per line - {"text": "...", "id"?: "..."}.
//              A bare JSON string ("just text") is also accepted as {text}.
//   - .txt   : one plain text record per line (no ids) - back-compat / quick tests.
//   - stdin  : same rules as .txt when piped.
// Detection is by file extension; stdin is treated as plain lines.

export interface InputRecord {
  text: string;
  id?: string;
}

export class InputSource {
  /** Read records from a file, dispatching on extension. */
  static async fromFile(path: string): Promise<InputRecord[]> {
    const raw = await readFile(path, "utf8");
    return /\.jsonl$/i.test(path)
      ? InputSource.parseJsonl(raw)
      : InputSource.parseLines(raw);
  }

  /** Read plain-line records from stdin. */
  static async fromStdin(): Promise<InputRecord[]> {
    const raw = await InputSource.readStdin();
    return InputSource.parseLines(raw);
  }

  /** JSONL: each non-blank line is {text,id?} or a bare JSON string. */
  static parseJsonl(raw: string): InputRecord[] {
    const out: InputRecord[] = [];
    let lineNo = 0;
    for (const line of raw.split(/\r?\n/)) {
      lineNo++;
      const t = line.trim();
      if (!t) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(t);
      } catch {
        throw new Error(`input JSONL: line ${lineNo} is not valid JSON`);
      }
      if (typeof obj === "string") {
        if (obj.trim()) out.push({ text: obj });
      } else if (
        obj &&
        typeof obj === "object" &&
        typeof (obj as InputRecord).text === "string"
      ) {
        const rec = obj as InputRecord;
        if (rec.text.trim())
          out.push({
            text: rec.text,
            ...(rec.id !== undefined ? { id: String(rec.id) } : {}),
          });
      } else {
        throw new Error(
          `input JSONL: line ${lineNo} must be {"text": "..."} or a JSON string`,
        );
      }
    }
    return out;
  }

  /** Plain text: one non-blank, trimmed record per line. */
  static parseLines(raw: string): InputRecord[] {
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((text) => ({ text }));
  }

  private static readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }
}
