import type { DistillConfig } from "./core/Config.js";

// ─── Public config helper ────────────────────────────────────────────────────
// Users write `distill.config.ts`:
//
//   import { defineConfig } from "@interactkit/distill";
//   export default defineConfig({ tags: [...], label: {...}, synth: {...} });
//
// defineConfig is an identity function - its only job is to attach the
// DistillConfig type so the editor gives autocomplete, hover docs, and compile
// errors on the literal. (Same pattern as Vite/Drizzle/Jest config helpers.)

export function defineConfig(config: DistillConfig): DistillConfig {
  return config;
}

export type { DistillConfig } from "./core/Config.js";

// Re-exported for the type annotation in *candidate* extractors during the
// build loop (`import type { LabelStore } from "@interactkit/distill"`). The
// SHIPPED artifact inlines a copy of this class and bundles its own train-only
// data, so it has no dependency on this package at runtime.
export { LabelStore } from "./core/LabelStore.js";
export type { GoldEntity } from "./domain/types.js";
