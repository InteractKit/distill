# Hosting

Once you've built an extractor (`distill build`), you can serve it over HTTP with
`distill host`. There are two modes.

```
distill host            # serve mode - run the built code (no LLM)
distill host --learn    # learn mode - serve LLM answers and keep improving the code
```

---

## Serve mode (default)

Runs the built `extractor.gen.ts` behind an HTTP endpoint. **No LLM, no API key,
no per-request cost** - just code. Fast and deterministic.

```bash
distill host --port 3000
```

```bash
curl -s localhost:3000/extract -d '{"text":"Marcus is an Engineer at Shopify."}'
```
```json
{ "entities": [
    { "text": "Marcus",   "tag": "PERSON" },
    { "text": "Engineer", "tag": "ROLE" },
    { "text": "Shopify",  "tag": "COMPANY" }
  ],
  "source": "code" }
```

Requires a prior `distill build` (it loads `extractor.gen.ts`). The built
extractor is self-contained, so serve mode needs no `cache.jsonl` at runtime.
(Learn mode still reads/writes `cache.jsonl` to grow the training corpus.)

---

## Learn mode (`--learn`)

This is **distillation from live traffic**. Every request is answered by the
**LLM** - so callers always get LLM-grade results - and each answer is captured
as a new training example. The code extractor is rebuilt in the background as
examples accumulate, and the server tracks how often the **code now agrees with
the LLM**.

When that agreement is consistently high, you stop paying for the LLM by
restarting **without** `--learn` - at which point you're serving the free,
distilled code that learned from your real inputs.

```bash
distill host --learn
```

```
POST /extract  →  { entities, source: "llm" }   # always LLM in learn mode
       │
       ├─ returned to the caller (LLM quality)
       └─ captured to cache.jsonl  →  background rebuild  →  extractor.gen.ts
```

### The workflow

1. Run `distill host --learn` and point your real traffic at it.
2. Watch `GET /metrics` - specifically `agreement_ratio` (how often the code
   matches the LLM over recent requests).
3. When agreement is high and stable, restart as `distill host` (no `--learn`).
   You're now serving free code that was trained on your production inputs.

> **Cost note:** learn mode calls the LLM on **every** request - that's the
> deal while it's learning. Serve mode calls nothing. Learn until ready, then
> switch off.

### When does it rebuild?

A background rebuild runs **periodically and only once enough new examples have
accumulated** - at most every `rebuildEverySec` (default 300s), and only when
≥ `minNewExamples` (default 25) new inputs have been captured. This avoids
rebuilding on idle traffic. A rebuild is skipped if one is already running.

---

## Endpoints

| Method & path | Description |
|---|---|
| `POST /extract` | Body `{ "text": "..." }` → `{ entities, source }`. `source` is `"code"` (serve) or `"llm"` (learn). |
| `GET /metrics` | Prometheus text format (scrapeable by Prometheus / Grafana / Datadog). |
| `GET /metrics?format=json` | The same metrics as JSON, for quick `curl` / humans. |
| `GET /health` | `{ "ok": true }`. |

### Metrics

| Metric | Meaning |
|---|---|
| `distill_requests_total` | Total `/extract` requests handled. |
| `distill_llm_calls_total` | LLM extractions performed (learn mode). |
| `distill_code_calls_total` | Code extractions served (serve mode). |
| `distill_errors_total` | Failed `/extract` requests. |
| `distill_rebuilds_total` | Completed background rebuilds. |
| `distill_learned_examples` | Distinct examples in the corpus. |
| `distill_new_since_build` | New examples captured since the last rebuild. |
| `distill_rebuilding` | `1` while a rebuild is in progress. |
| `distill_extractor_built` | `1` if a code extractor is loaded. |
| **`distill_agreement_ratio`** | **Code-vs-LLM agreement over recent traffic (learn mode). Your "ready to switch off `--learn`" signal.** |
| `distill_agreement_window` | Sample size of the agreement window. |

---

## Configuration

Defaults live under a `host` block in your config (all optional):

```ts
host: {
  port: 3000,              // HTTP port
  rebuildEverySec: 300,    // learn mode: min seconds between rebuilds
  minNewExamples: 25,      // learn mode: min new examples before a rebuild
}
```

`--port` on the CLI overrides `host.port`.

---

## Which mode when?

| You want… | Use |
|---|---|
| Fast, free, deterministic extraction from an extractor you've already built | `distill host` |
| To keep improving the extractor from real production inputs, LLM-quality meanwhile | `distill host --learn` |
| A one-off batch over a file (no server) | [`distill run`](cli.md#distill-run) |
