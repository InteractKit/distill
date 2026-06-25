import "dotenv/config";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";

// ─── Provider resolution ─────────────────────────────────────────────────────
// Maps a (provider, model) pair to an AI SDK LanguageModel. Both the label and
// synth stages resolve their backend independently through here, so each block
// can target a different provider.

export type ProviderName = "openai" | "anthropic" | "google" | "ollama";

export const PROVIDERS: ProviderName[] = ["openai", "anthropic", "google", "ollama"];

/** Env var that holds the key for each cloud provider (Ollama needs none). */
const KEY_ENV: Record<ProviderName, string | null> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  ollama: null,
};

export class Provider {
  /** Resolve a language model, throwing a clear error if the key is missing. */
  static model(provider: ProviderName, modelId: string): LanguageModel {
    const keyEnv = KEY_ENV[provider];
    if (keyEnv && !process.env[keyEnv]) {
      throw new Error(`${keyEnv} is not set (required for provider "${provider}"). Add it to .env.`);
    }
    switch (provider) {
      case "openai":
        return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
      case "anthropic":
        return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
      case "google":
        return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(modelId);
      case "ollama":
        return createOllama({ baseURL: process.env.OLLAMA_HOST })(modelId);
      default:
        throw new Error(`unknown provider "${provider}"`);
    }
  }

  static isValid(p: string): p is ProviderName {
    return (PROVIDERS as string[]).includes(p);
  }

  /**
   * Reasoning models reject sampling params (temperature). Currently only the
   * OpenAI o-series / gpt-5.x are treated this way.
   */
  static isReasoningModel(provider: ProviderName, model: string): boolean {
    return provider === "openai" && /^(o[1345]|gpt-5)/i.test(model);
  }
}
