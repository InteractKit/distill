import "dotenv/config";
import { generateText, type LanguageModel, type ToolSet } from "ai";
import { Provider, type ProviderName } from "./Provider.js";

// Silence the AI SDK's non-actionable warnings (e.g. "temperature is not
// supported for reasoning models") - we omit unsupported params per-model below,
// so the warnings are pure noise. Must be set before any generate* call.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

// ─── LlmClient: the one wrapper around the AI SDK + OpenAI ───────────────────
// Centralizes provider creation, the reasoning-model sampling guard, and both
// the plain-completion and tool-calling entry points used across the pipeline.

export interface CompleteOptions {
  /** Preserve the raw text (diff markers / mixed output); skip fence-stripping. */
  raw?: boolean;
}

export interface ToolRunOptions {
  system: string;
  prompt: string;
  tools: ToolSet;
  stopWhen?: Parameters<typeof generateText>[0]["stopWhen"];
}

export class LlmClient {
  private readonly languageModel: LanguageModel;

  constructor(
    private readonly provider: ProviderName,
    private readonly model: string,
    private readonly temperature: number,
  ) {
    // Resolves the backend and validates the required API key up front.
    this.languageModel = Provider.model(provider, model);
  }

  /** Optional sampling fields, omitted for reasoning models that reject them. */
  private sampling(): { temperature?: number } {
    return Provider.isReasoningModel(this.provider, this.model)
      ? {}
      : { temperature: this.temperature };
  }

  /** A plain system+user completion. */
  async complete(
    system: string,
    user: string,
    opts: CompleteOptions = {},
  ): Promise<string> {
    const { text } = await generateText({
      model: this.languageModel,
      ...this.sampling(),
      system,
      prompt: user,
    });
    return opts.raw ? text.trim() : LlmClient.stripFences(text);
  }

  /** A tool-calling run (agentic). Returns final text + step count. */
  async runWithTools(
    opts: ToolRunOptions,
  ): Promise<{ text: string; steps: number }> {
    const { text, steps } = await generateText({
      model: this.languageModel,
      ...this.sampling(),
      system: opts.system,
      prompt: opts.prompt,
      tools: opts.tools,
      stopWhen: opts.stopWhen,
    });
    return { text: text.trim(), steps: steps.length };
  }

  /** Strip a single surrounding code fence (for full-file source generation). */
  private static stripFences(s: string): string {
    const trimmed = s.trim();
    const m = trimmed.match(
      /^```(?:ts|typescript|javascript|js)?\s*\n([\s\S]*?)\n```$/,
    );
    return (m ? m[1] : trimmed).trim();
  }
}
