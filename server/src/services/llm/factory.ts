import type { ILLMProvider } from "./types.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { MockLLMProvider } from "./mock.js";

let activeProvider: ILLMProvider | null = null;

export function getLLMProvider(overrideProvider?: ILLMProvider | string): ILLMProvider {
  // If an explicit provider object is passed, return it
  if (typeof overrideProvider === "object" && overrideProvider !== null) {
    return overrideProvider;
  }

  // If a provider name was explicitly requested (e.g. "gemini", "mock", "openai")
  if (typeof overrideProvider === "string") {
    switch (overrideProvider.toLowerCase()) {
      case "gemini":
      case "google":
        return new GeminiProvider();
      case "mock":
      case "test":
        return new MockLLMProvider();
      case "openai":
      default:
        return new OpenAICompatibleProvider();
    }
  }

  // If a global provider was explicitly set, return it
  if (activeProvider) {
    return activeProvider;
  }

  // Default provider from environment or fallback to OpenAI-compatible
  const envProvider = process.env.LLM_PROVIDER?.toLowerCase() || "openai";
  switch (envProvider) {
    case "gemini":
    case "google":
      activeProvider = new GeminiProvider();
      break;
    case "mock":
    case "test":
      activeProvider = new MockLLMProvider();
      break;
    case "openai":
    default:
      activeProvider = new OpenAICompatibleProvider();
      break;
  }

  return activeProvider;
}

export function setGlobalLLMProvider(provider: ILLMProvider | null): void {
  activeProvider = provider;
}
