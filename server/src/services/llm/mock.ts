import type { ILLMProvider, LLMPrompt } from "./types.js";

export class MockLLMProvider implements ILLMProvider {
  public readonly name = "mock";
  private customResponse?: string;

  constructor(customResponse?: string) {
    this.customResponse = customResponse;
  }

  setResponse(response: string): void {
    this.customResponse = response;
  }

  async generateText(prompt: LLMPrompt): Promise<string> {
    if (this.customResponse !== undefined) {
      return this.customResponse;
    }

    // Default mock behavior: looks for simple date and amount in text, or returns empty array
    if (prompt.userPrompt.includes("UPI/50123/Swiggy")) {
      return JSON.stringify([
        {
          date: "2026-02-10",
          narration: "UPI/50123/Swiggy Bangalore",
          type: "debit",
          amount: 450.5,
          balance: 98549.5,
        },
      ]);
    }

    return "[]";
  }
}
