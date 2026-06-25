# Providers

The `label` and `synth` stages each choose a provider independently. Set the
`provider` field in your config and put the matching API key in `.env`.

| Provider | `provider` value | API key (env var) |
|---|---|---|
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` |
| Google (Gemini) | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Ollama (local) | `ollama` | _none_ (optional `OLLAMA_HOST`) |

## Setup

Copy the template and fill in the key(s) you need:

```bash
cp .env.example .env
```

```bash
# .env
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_GENERATIVE_AI_API_KEY=...
# OLLAMA_HOST=http://localhost:11434/api   # only to override the default
```

You only need keys for the providers your config actually uses. `distill run`
needs **no** key at all.

## Mixing providers

The two stages are independent - use a cheap model to label and a stronger one
to write code, even across providers:

```ts
label: { provider: "openai",    model: "gpt-4o-mini" },
synth: { provider: "anthropic", model: "claude-sonnet-4-6" },
```

## Local with Ollama

Run fully offline (no API key, no data leaving your machine):

```ts
label: { provider: "ollama", model: "qwen3.5:4b" },
synth: { provider: "ollama", model: "qwen3.5:4b" },
```

Make sure the Ollama server is running and the model is pulled
(`ollama pull qwen3.5:4b`). Override the host with `OLLAMA_HOST` if it isn't the
default `http://localhost:11434`.

## Notes

- **Reasoning models** (e.g. OpenAI `gpt-5.x` / `o`-series) ignore `temperature`;
  distill omits it automatically for those.
- An invalid `provider` value, or a missing key for the chosen provider, fails
  fast with a clear message before any work starts.
