import type { ILLMProvider, LLMPrompt } from "./types.js";

export class GeminiError extends Error {
  public status: number;
  public model: string;

  constructor(message: string, status: number, model: string) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.model = model;
  }
}

const DEFAULT_RETRY_DELAYS = [2000, 4000, 8000, 16000];

async function callGeminiSingle(
  model: string,
  apiKey: string,
  prompt: LLMPrompt
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: prompt.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: prompt.temperature ?? 0.0,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (networkErr: unknown) {
    const netMsg = networkErr instanceof Error ? networkErr.message : "Network error contacting Gemini API.";
    throw new GeminiError(netMsg, 503, model);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let errMsg = `Gemini API request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) {
        errMsg = parsed.error.message;
      }
    } catch {
      if (errText) {
        errMsg = errText;
      }
    }
    throw new GeminiError(errMsg, response.status, model);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new GeminiError("Invalid or empty response received from Gemini API.", 502, model);
  }

  return text;
}

async function callModelWithRetries(
  model: string,
  apiKey: string,
  prompt: LLMPrompt,
  retryDelays: number[] = DEFAULT_RETRY_DELAYS
): Promise<string> {
  let lastError: GeminiError | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      return await callGeminiSingle(model, apiKey, prompt);
    } catch (err: unknown) {
      if (err instanceof GeminiError) {
        lastError = err;
        const isRetryable = err.status === 503 || err.status === 429 || err.status === 500;
        const isDoNotRetry =
          err.status === 400 ||
          err.status === 401 ||
          err.status === 403 ||
          err.status === 404;

        if (isDoNotRetry || !isRetryable || attempt >= retryDelays.length) {
          throw err;
        }

        const delayMs = retryDelays[attempt] + Math.random() * 500;
        console.error(
          `[Gemini Retry] Model: ${model} returned ${err.status}. Retrying (${attempt + 1}/${retryDelays.length}) in ${Math.round(delayMs)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }

  throw lastError || new GeminiError("The AI model is busy. Please try again in a minute.", 503, model);
}

export class GeminiProvider implements ILLMProvider {
  public readonly name = "gemini";
  public readonly model: string;
  public readonly fallbackModel: string;
  private apiKey: string;
  private retryDelays: number[];

  constructor(options?: {
    apiKey?: string;
    model?: string;
    fallbackModel?: string;
    retryDelays?: number[];
  }) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || "";
    this.model = options?.model || process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-3.5-flash";
    this.fallbackModel =
      options?.fallbackModel || process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
    this.retryDelays = options?.retryDelays || DEFAULT_RETRY_DELAYS;
  }

  async generateText(prompt: LLMPrompt): Promise<string> {
    if (!this.apiKey) {
      throw new GeminiError(
        "GEMINI_API_KEY or LLM_API_KEY is not configured in server environment variables.",
        500,
        this.model
      );
    }

    try {
      return await callModelWithRetries(this.model, this.apiKey, prompt, this.retryDelays);
    } catch (err: unknown) {
      const isRetryableFailure =
        err instanceof GeminiError &&
        (err.status === 503 || err.status === 429 || err.status === 500);

      // If primary model failed after retries, try one attempt sequence with fallback model
      if (isRetryableFailure && this.fallbackModel && this.fallbackModel !== this.model) {
        console.error(
          `[Gemini Fallback] Primary model (${this.model}) returned ${(err as GeminiError).status}. Trying fallback model (${this.fallbackModel})...`
        );
        try {
          return await callModelWithRetries(
            this.fallbackModel,
            this.apiKey,
            prompt,
            this.retryDelays
          );
        } catch (fallbackErr: unknown) {
          console.error(
            `[Gemini Fallback Failed] Fallback model (${this.fallbackModel}) also failed.`
          );
          throw new GeminiError(
            "The AI model is busy. Please try again in a minute.",
            503,
            this.fallbackModel
          );
        }
      }

      if (isRetryableFailure) {
        throw new GeminiError(
          "The AI model is busy. Please try again in a minute.",
          503,
          this.model
        );
      }

      throw err;
    }
  }
}
