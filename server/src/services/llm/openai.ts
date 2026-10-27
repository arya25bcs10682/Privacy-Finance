import type { ILLMProvider, LLMPrompt } from "./types.js";

export class OpenAICompatibleProvider implements ILLMProvider {
  public readonly name = "openai-compatible";
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(options?: { apiKey?: string; baseURL?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
    this.baseURL = options?.baseURL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    this.model = options?.model || process.env.LLM_MODEL || "gpt-4o-mini";
  }

  async generateText(prompt: LLMPrompt): Promise<string> {
    if (!this.apiKey) {
      throw new Error("LLM_API_KEY is not configured in server environment variables.");
    }

    const endpoint = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
        temperature: prompt.temperature ?? 0.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM API request failed with status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Invalid or empty response received from LLM provider.");
    }

    return content;
  }
}
