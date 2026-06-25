<p align="center">
  <img src="https://raw.githubusercontent.com/InteractKit/distill/main/images/hero.png" alt="distill" width="720">
</p>

<p align="center"><b>Extract structured data from text - without calling an LLM at runtime.</b></p>

---

You want to pull fields out of messy text (names, companies, skills, prices,
dates…). The normal way is to call GPT for every document - but that's slow,
costs money per call, and gives different answers each time.

distill flips it: an LLM writes a small **extractor program** for you, *once*.
After that, you run plain code - instant, free, and the same every time.

### Example

Give it text like this:

```
Elena Vasquez is a Staff Engineer at Netflix with 9 years in Go and Rust.
```

…and the extractor it builds pulls out:

```json
{
  "entities": [
    { "text": "Elena Vasquez",  "tag": "PERSON" },
    { "text": "Staff Engineer",  "tag": "ROLE" },
    { "text": "Netflix",         "tag": "COMPANY" },
    { "text": "9 years",         "tag": "YEARS" },
    { "text": "Go",              "tag": "SKILL" },
    { "text": "Rust",            "tag": "SKILL" }
  ]
}
```

You define the fields you want (`PERSON`, `ROLE`, …). distill figures out how to
extract them and writes the code.

---

## Why not just call the LLM each time?

| | Call an LLM per document | distill |
|---|---|---|
| **Speed** | seconds per doc | microseconds (plain code) |
| **Cost** | pay per document, forever | pay once to build, then free |
| **Consistency** | varies run to run | identical every time |
| **Offline** | no (needs the API) | yes (it's just code) |

You pay the LLM **once** to build the extractor. Then run it on a million
documents for free. Best for **high-volume, repetitive extraction** - resumes,
support tickets, logs, product feeds.

---

## How it works

Three steps, two of which are one-time:

```
1. LABEL    Your example texts ──▶ an LLM labels them   (builds training data)
2. BUILD    Training data ──▶ an LLM writes & tunes the extractor code
3. RUN      New text ──▶ the generated code ──▶ JSON     (no LLM - just code)
```

Steps 1–2 happen once (`distill build`). Step 3 is what you run in production.

The generated `extractor.gen.ts` is **fully self-contained**: it bundles
everything it learned, so it has no runtime dependencies - not even on distill
itself. Copy that one file anywhere and call `extract(text)`.

---

## Quick start

```bash
npm install -g @interactkit/distill

distill init my-extractor       # creates a starter project
cd my-extractor

cp .env.example .env            # add your OPENAI_API_KEY
#  → edit distill.config.ts: list the fields you want to extract
#  → edit data.jsonl: paste example texts to learn from

distill build                   # one-time: writes extractor.gen.ts
distill run --in data.jsonl     # run it - outputs JSON, no LLM
# or: distill host              # serve it over HTTP
```

## What you provide

Just two things: **your example texts** and **the fields you want**.

**1. Example texts** - `data.jsonl`, one per line. These are what the extractor
learns from:

```json
{"text": "Elena Vasquez is a Staff Engineer at Netflix with 9 years in Go and Rust."}
{"text": "Marcus Lee, a Backend Engineer at Shopify, knows Python and Kubernetes."}
{"text": "Priya Nair, Senior Data Scientist at Stripe, 6 years with TensorFlow."}
```

(A few dozen to a few hundred lines is plenty. No labels needed - distill labels
them for you in step 1.)

**2. The fields to extract** - `distill.config.ts`. You list each field with a
plain-English description, plus which models to use:

```ts
import { defineConfig } from "@interactkit/distill";

export default defineConfig({
  tags: [
    { name: "PERSON",  description: "A person's full name" },
    { name: "COMPANY", description: "An employer or organization" },
    { name: "SKILL",   description: "A technical skill or technology" },
  ],
  label: { provider: "openai", model: "gpt-4o-mini" },   // labels your examples
  synth: { provider: "openai", model: "gpt-5.4-mini" },  // writes the extractor
});
```

(`tag` = a field / entity type to extract. JSON config works too if you prefer.)

## Use the extractor

Two ways to run what you built - both pure code, no LLM:

```bash
# Batch a file (or pipe via stdin):
distill run --in data.jsonl > results.jsonl

# Or serve it over HTTP:
distill host                 # POST /extract {"text":"..."} → {entities}
```

### Keep it learning from live traffic (optional)

`distill host --learn` answers every request with the **LLM** (so callers always
get LLM-grade results) while quietly capturing those answers and rebuilding the
code extractor in the background. Watch `GET /metrics` - when the code reliably
agrees with the LLM, restart without `--learn` to serve the free, distilled code.
It's a hands-off way to build the extractor from your real production inputs.
See **[Hosting](https://github.com/InteractKit/distill/blob/main/docs/hosting.md)**.

## Commands

| Command | What it does | Calls an LLM? |
|---|---|---|
| `distill init` | Create a starter project | no |
| `distill build` | Label examples, then generate the extractor | **yes** (one-time) |
| `distill run` | Run the extractor on new text → JSON | **no** |
| `distill host` | Serve the extractor over HTTP | no (unless `--learn`) |
| `distill label` | Just the labeling step | yes |

`run` reads `--in <file>` or stdin and writes `--out <file>` or stdout.

## Documentation

- [How it works](https://github.com/InteractKit/distill/blob/main/docs/how-it-works.md) - the full pipeline, in depth
- [CLI reference](https://github.com/InteractKit/distill/blob/main/docs/cli.md) - every command and flag
- [Configuration](https://github.com/InteractKit/distill/blob/main/docs/configuration.md) - all config options
- [Input & output](https://github.com/InteractKit/distill/blob/main/docs/input-output.md) - data formats
- [Providers](https://github.com/InteractKit/distill/blob/main/docs/providers.md) - OpenAI, Anthropic, Google, Ollama
- [Hosting](https://github.com/InteractKit/distill/blob/main/docs/hosting.md) - serve over HTTP, learn from live traffic, metrics

## License

ISC
