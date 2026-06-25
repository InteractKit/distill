# Input & output

## Input data (`data.jsonl`)

One JSON record per line:

```json
{"text": "Ada Lovelace works at Analytical Engines and knows Python."}
{"id": "r2", "text": "Grace Hopper was fluent in COBOL."}
```

| Field | Required | Description |
|---|---|---|
| `text` | **yes** | The text to extract from. |
| `id` | no | An identifier carried through to `run` output, so results map back to source rows. |

A bare JSON string is also accepted as shorthand for `{ "text": ... }`:

```json
"Ada Lovelace works at Analytical Engines."
```

### Plain text (`.txt`)

For quick tests, a `.txt` file with **one record per line** works too (no ids):

```
Ada Lovelace works at Analytical Engines.
Grace Hopper was fluent in COBOL.
```

`distill run` reading from **stdin** uses these plain-line rules.

## Labeled cache (`cache.jsonl`)

`build` / `label` write the labeled corpus here - one row per input:

```json
{"input": "Ada Lovelace works at Analytical Engines.",
 "entities": [{"text": "Ada Lovelace", "tag": "PERSON"},
              {"text": "Analytical Engines", "tag": "ORG"}]}
```

This file is **resumable**: re-running only labels inputs that aren't already in
it. Delete it (or use `--relabel`) to start fresh.

## Run output

`distill run` emits JSONL, one row per input:

```json
{"id": "r2", "input": "Grace Hopper was fluent in COBOL.",
 "entities": [{"text": "Grace Hopper", "tag": "PERSON"},
              {"text": "COBOL", "tag": "SKILL"}]}
```

- `id` is included **only** when the input row had one.
- `entities` is an array of `{ text, tag }`. Each `text` appears verbatim in the
  input; each `tag` is one of your configured tags.
- Inputs with no entities produce `"entities": []`.

Output goes to `--out <file>`, or to **stdout** if omitted (so you can pipe it).
