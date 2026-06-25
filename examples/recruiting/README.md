# Example: recruiting / resume extraction

A sample `distill` project. From this directory:

```bash
cp ../../.env.example .env   # add OPENAI_API_KEY
distill build                # label data.jsonl -> synth -> extractor.gen.ts
distill run --in data.jsonl  # apply the built extractor (no LLM)
```

`distill.config.ts` imports `defineConfig` from the local source (`../../src`) so
it runs in-repo. A real installed project imports it from `"@interactkit/distill"`.

The resulting `extractor.gen.ts` is self-contained - it bundles its own learned
knowledge, so `distill run` (and the file itself) needs no cache or package at
runtime.
