# Configuration

A distill project is two files you write:

- **`data.jsonl`** - your example texts to learn from, one per line:
  ```json
  {"text": "Elena Vasquez is a Staff Engineer at Netflix with 9 years in Go."}
  {"text": "Marcus Lee, a Backend Engineer at Shopify, knows Python."}
  ```
  (See [Input & output](input-output.md) for the full format.)

- **`distill.config.ts`** - the fields to extract and which models to use
  (covered below).

distill is driven by that **one config file**. Use a typed `distill.config.ts`
(recommended) or a plain `task.json`. When you don't pass `--task`, distill
auto-discovers it in the current directory in this order:

1. `distill.config.ts`
2. `distill.config.js`
3. `task.json`

## Typed config (`distill.config.ts`)

```ts
import { defineConfig } from "@interactkit/distill";

export default defineConfig({
  instruction: "Extract entities from this resume or recruiting text.",

  tags: [
    { name: "PERSON", description: "A person's full name" },
    { name: "ORG", description: "A company or organization" },
    { name: "SKILL", description: "A technical skill or technology" },
  ],

  examples: [
    {
      input: "Ada Lovelace works at Analytical Engines and knows Python.",
      entities: [
        { text: "Ada Lovelace", tag: "PERSON" },
        { text: "Analytical Engines", tag: "ORG" },
        { text: "Python", tag: "SKILL" },
      ],
    },
    // A negative example (no entities) is useful too:
    { input: "Looking for a remote role next quarter.", entities: [] },
  ],

  io: {
    data: "data.jsonl",
    cache: "cache.jsonl",
    output: "extractor.gen.ts",
  },

  label: { provider: "openai", model: "gpt-4o-mini", concurrency: 8 },

  synth: {
    provider: "openai",
    model: "gpt-5.4-mini",
    rounds: 6,
    population: { size: 4, survivors: 2, diversity: "per-tag-niche", crossover: true },
  },
});
```

`defineConfig` is just an identity function that attaches the type, so your
editor gives you autocomplete, hover docs, and compile errors. It's executable
TypeScript - you can compute values, import constants, or branch on env vars.

## JSON config (`task.json`)

The same shape as plain JSON, for CI or scripted use:

```json
{
  "instruction": "Extract entities from this text.",
  "tags": [{ "name": "PERSON", "description": "A person's full name" }],
  "io": { "data": "data.jsonl", "cache": "cache.jsonl", "output": "extractor.gen.ts" },
  "label": { "provider": "openai", "model": "gpt-4o-mini" },
  "synth": { "provider": "openai", "model": "gpt-5.4-mini" }
}
```

## Field reference

### Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `tags` | `{ name, description }[]` | **yes** | The closed set of entity types to extract. `description` guides the labeler and the synthesized code. |
| `instruction` | `string` | no | One line describing the task. Shown to the labeler and code-writer. |
| `examples` | `{ input, entities }[]` | no | Few-shot examples. `entities` is `{ text, tag }[]` (use `[]` for a negative example). Helps small labeling models. (A legacy `output` string is still accepted but deprecated.) |

### `io` - file paths (relative to the config file)

| Field | Default | Description |
|---|---|---|
| `data` | `data.jsonl` | Raw inputs to label. See [Input & output](input-output.md). |
| `cache` | `cache.jsonl` | Labeled corpus. Auto-generated; resumable. |
| `output` | `extractor.gen.ts` | The synthesized extractor code. Auto-generated. |

### `label` - stage 1 (labeling)

| Field | Default | Description |
|---|---|---|
| `provider` | `openai` | `openai` · `anthropic` · `google` · `ollama`. See [Providers](providers.md). |
| `model` | `gpt-4o-mini` | The labeling model. A light model is fine here. |
| `concurrency` | `8` | Parallel labeling requests. |
| `temperature` | `0` | Sampling temperature (deterministic by default). |
| `retries` | `2` | Retry attempts per row on transport errors. |

### `synth` - stage 2 (code synthesis)

| Field | Default | Description |
|---|---|---|
| `provider` | `openai` | Provider for the code-writing model. |
| `model` | `gpt-5.4-mini` | The model that writes and improves the extractor. |
| `rounds` | `6` | Refinement rounds (generations). |
| `temperature` | `0.2` | Sampling temperature (ignored for reasoning models). |
| `trainFrac` | `0.7` | Fraction of data used to build knowledge / train. |
| `devFrac` | `0.15` | Fraction used to score and guide improvements. The rest is a held-out test set. |
| `population` | _see below_ | Evolutionary search settings. |

### `synth.population` - candidate search

| Field | Default | Description |
|---|---|---|
| `size` | `1` | Candidate extractors kept alive each round. `1` = simple hill-climb. |
| `survivors` | `ceil(size/2)` | How many top candidates breed each round. |
| `diversity` | `per-tag-niche` | `per-tag-niche` keeps the candidates distinct (one specialist per tag + a generalist); `top-k` keeps the highest-scoring (may converge). |
| `crossover` | `true` when `size > 1` | Combine two candidates' per-tag strengths into a child. |

See [How it works](how-it-works.md) for what population and niching actually do,
and the cost trade-off (`size: 4` ≈ 4× the build cost).

## Environment overrides

These env vars set defaults when a config field is omitted (the config file
always wins):

| Var | Sets |
|---|---|
| `LABEL_PROVIDER` / `LABEL_MODEL` | default labeling backend |
| `SYNTH_PROVIDER` / `SYNTH_MODEL` | default synthesis backend |

Provider API keys also live in the environment - see [Providers](providers.md).
