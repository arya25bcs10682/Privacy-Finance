import { z } from "zod";
import { getLLMProvider } from "./llm/factory.js";
import type { ILLMProvider } from "./llm/types.js";

// Zod schema for individual parsed transaction
export const ParsedTransactionSchema = z.object({
  date: z
    .string()
    .transform((d) => {
      const trimmed = d.trim();
      const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
      }
      const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
      }
      return trimmed;
    })
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be normalized to YYYY-MM-DD ISO format")),
  narration: z.string().min(1, "Narration cannot be empty"),
  type: z.union([
    z.enum(["debit", "credit"]),
    z.string().transform((t) => (t.toLowerCase().includes("cr") ? "credit" : "debit")),
  ]),
  amount: z
    .union([z.number(), z.string().transform((v) => parseFloat(v.replace(/,/g, "")))])
    .pipe(z.number().nonnegative("Amount must be a non-negative number")),
  balance: z
    .union([z.number(), z.string().transform((v) => parseFloat(v.replace(/,/g, ""))), z.null(), z.undefined()])
    .transform((v) => (typeof v === "number" && !isNaN(v) ? v : 0)),
});

// Zod schema for transaction array
export const ParsedTransactionsListSchema = z.array(ParsedTransactionSchema);

export type ParsedTransaction = z.infer<typeof ParsedTransactionSchema>;

export const SYSTEM_PROMPT = `You are an expert, high-precision bank statement transaction parsing engine.
Your goal is to parse raw text extracted from a bank statement page into structured JSON transaction records.

STRICT OPERATIONAL RULES:
1. Return ONLY dated transaction rows. Ignore headers, footers, page totals, and any summary or table that is not a dated transaction.
2. Return ONLY a valid JSON array of transaction objects:
   [
     {
       "date": "YYYY-MM-DD",
       "narration": "Full description/narration",
       "type": "debit" | "credit",
       "amount": 123.45,
       "balance": 1234.56
     }
   ]
3. Return RAW JSON ONLY. Never wrap in markdown, backticks, or codeblocks (no \`\`\`json). Never include conversational filler, notes, headers, or explanations.
4. Date format: Normalize all dates (e.g. "12/01/2026", "12-Jan-2026", "12.01.2026") strictly to "YYYY-MM-DD" ISO format.
5. Transaction Type: Must be lowercase "debit" (money out/withdrawal) or "credit" (money in/deposit).
6. Amount: Positive floating-point or integer number. Do not include commas or currency symbols.
7. Balance: The running balance after the transaction as a number. If missing or obscured, use 0.
8. PRESERVATION: Preserve EVERY SINGLE transaction row. NEVER summarize, omit, or aggregate rows.
9. INTEGRITY: NEVER invent, hallucinate, or extrapolate transactions not present in the text.
10. EMPTY PAGES: If the provided page text has no transaction rows (e.g., covers, disclaimers, fee notices, contact pages, or summary tables), return an empty array: [].`;

/**
 * Clean potential markdown wrappers or surrounding text from LLM response
 */
function cleanJsonString(rawText: string): string {
  let cleaned = rawText.trim();
  // Strip ```json or ``` code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  // Extract strictly between [ and ] if surrounded by extra text
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned.trim();
}

/**
 * Parses raw statement page text into validated structured transactions.
 * Zero-knowledge guarantee: Request text and response are never logged or persisted.
 * Retries once on invalid JSON or Zod schema mismatch.
 */
export async function parseStatementText(
  pageText: string,
  options?: { provider?: ILLMProvider }
): Promise<ParsedTransaction[]> {
  const provider = options?.provider || getLLMProvider();

  // Attempt 1
  const firstRawResponse = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: pageText,
    temperature: 0.0,
  });

  const firstAttempt = tryParseAndValidate(firstRawResponse);
  if (firstAttempt.success) {
    return firstAttempt.data;
  }

  // Attempt 2 (Retry once on invalid JSON or schema error)
  const retryPrompt = `Your previous response failed validation:
${firstAttempt.error}

Raw page text:
${pageText}

Please correct your output and return strictly a valid JSON array of transaction objects adhering to the schema. Output raw JSON only.`;

  const secondRawResponse = await provider.generateText({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: retryPrompt,
    temperature: 0.0,
  });

  const secondAttempt = tryParseAndValidate(secondRawResponse);
  if (secondAttempt.success) {
    return secondAttempt.data;
  }

  throw new Error(
    `Failed to parse statement transactions after retry. Validation error: ${secondAttempt.error}`
  );
}

/**
 * Helper: Parse JSON and validate with Zod
 */
function tryParseAndValidate(
  rawText: string
): { success: true; data: ParsedTransaction[] } | { success: false; error: string } {
  try {
    const cleaned = cleanJsonString(rawText);
    const parsedJson: unknown = JSON.parse(cleaned);

    const result = ParsedTransactionsListSchema.safeParse(parsedJson);
    if (!result.success) {
      const errorMsg = result.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      return { success: false, error: `Schema validation failed: ${errorMsg}` };
    }

    return { success: true, data: result.data };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
