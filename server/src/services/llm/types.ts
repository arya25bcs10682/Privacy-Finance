export interface LLMPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface ILLMProvider {
  readonly name: string;
  generateText(prompt: LLMPrompt): Promise<string>;
}
