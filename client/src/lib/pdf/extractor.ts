import * as pdfjsLib from "pdfjs-dist";
import { redactPii, type RedactionResult } from "./redact";
import { apiFetch } from "../api";
import { encryptJSON, hmacTxHash } from "../crypto";
import {
  truncatePagesAtSummaryMarker,
  type StatementSummary,
} from "./statementSummary";

// Configure pdfjs worker
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  } catch {
    // Fallback if URL resolution fails
  }
}

export class PdfPasswordRequiredError extends Error {
  constructor(message = "Password required to decrypt bank statement PDF.") {
    super(message);
    this.name = "PdfPasswordRequiredError";
  }
}

export class StatementParsingError extends Error {
  public status: number;
  public stage: string;
  public failedChunkIndex: number;
  public totalChunks: number;
  public parsedTransactions: RawParsedTransaction[];
  public chunks: string[];

  constructor(
    message: string,
    options: {
      status?: number;
      stage?: string;
      failedChunkIndex: number;
      totalChunks: number;
      parsedTransactions: RawParsedTransaction[];
      chunks: string[];
    }
  ) {
    super(message);
    this.name = "StatementParsingError";
    this.status = options.status ?? 503;
    this.stage = options.stage ?? "llm";
    this.failedChunkIndex = options.failedChunkIndex;
    this.totalChunks = options.totalChunks;
    this.parsedTransactions = options.parsedTransactions;
    this.chunks = options.chunks;
  }
}

export interface ParseResumeState {
  chunks: string[];
  startChunkIndex: number;
  accumulatedTransactions: RawParsedTransaction[];
  totalPages?: number;
}

export interface ExtractedPage {
  pageNumber: number;
  rawText: string;
  redacted: RedactionResult;
}

export interface RawParsedTransaction {
  date: string;
  narration: string;
  type: "debit" | "credit";
  amount: number;
  balance: number;
}

export interface ParsePageResponse {
  transactions: RawParsedTransaction[];
  count: number;
  pageNumber?: number;
}

export interface StatementProcessingProgress {
  currentPage: number;
  totalPages: number;
  currentChunk?: number;
  totalChunks?: number;
  stage: "extracting" | "redacting" | "parsing_llm" | "encrypting" | "complete";
  extractedCount: number;
  message?: string;
}

/**
 * Extracts raw and redacted text page-by-page from a bank statement PDF.
 * If password-protected, the password is used in browser memory only and never stored or sent.
 */
export async function extractStatementPages(
  fileData: ArrayBuffer | Uint8Array,
  password?: string
): Promise<ExtractedPage[]> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData),
      password: password || undefined,
    });

    const doc = await loadingTask.promise;
    const totalPages = doc.numPages;
    const pages: ExtractedPage[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Concatenate text items preserving space
      const textItems = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");

      const redacted = redactPii(textItems);

      pages.push({
        pageNumber: pageNum,
        rawText: textItems,
        redacted,
      });
    }

    return pages;
  } catch (err: unknown) {
    if (err && typeof err === "object" && ("name" in err || "message" in err)) {
      const name = (err as { name?: string }).name;
      const message = String((err as { message?: string }).message || "");
      if (name === "PasswordException" || message.toLowerCase().includes("password")) {
        throw new PdfPasswordRequiredError();
      }
    }
    throw err;
  }
}

/**
 * Encrypts valid, non-excluded transactions client-side and saves them to /api/transactions/bulk.
 */
export async function encryptAndSaveTransactions(
  transactions: {
    date: string;
    narration: string;
    type: "debit" | "credit";
    amount: number;
    balance: number;
    isExcluded?: boolean;
  }[],
  dataKey: CryptoKey,
  accountId?: string
): Promise<{ insertedCount: number; skippedCount: number; total: number }> {
  const activeTransactions = transactions.filter((tx) => !tx.isExcluded);

  if (activeTransactions.length === 0) {
    return { insertedCount: 0, skippedCount: 0, total: 0 };
  }

  const encryptedBatch = await Promise.all(
    activeTransactions.map(async (tx) => {
      const month = tx.date.substring(0, 7); // YYYY-MM
      const txHash = await hmacTxHash(
        {
          date: tx.date,
          amount: tx.amount,
          type: tx.type,
          cleanedDescription: tx.narration,
          runningBalance: tx.balance,
        },
        dataKey
      );

      const encrypted = await encryptJSON(tx, dataKey);

      return {
        txHash,
        month,
        accountId,
        encryptedPayload: {
          iv: encrypted.iv,
          ct: encrypted.ciphertext,
        },
      };
    })
  );

  return apiFetch<{
    insertedCount: number;
    skippedCount: number;
    total: number;
  }>("/transactions/bulk", {
    method: "POST",
    body: JSON.stringify({ transactions: encryptedBatch }),
  });
}

/**
 * Splits extracted redacted statement text into chunks of ~30 transaction lines.
 */
export function splitTextIntoTransactionChunks(
  text: string,
  targetTxLinesPerChunk = 30
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let lines: string[];
  if (trimmed.includes("\n")) {
    lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    // If text was concatenated on a single line, split by date boundaries
    const parts = trimmed.split(
      /(?=\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b)/g
    );
    if (parts.length > 1) {
      lines = parts.map((p) => p.trim()).filter(Boolean);
    } else {
      return [trimmed];
    }
  }

  const TX_LINE_REGEX =
    /\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-\s]\d{2,4})\b/i;

  const txLineIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (TX_LINE_REGEX.test(line)) {
      txLineIndices.push(idx);
    }
  });

  // If total transaction lines <= targetTxLinesPerChunk, return 1 chunk
  if (txLineIndices.length <= targetTxLinesPerChunk) {
    if (lines.length > targetTxLinesPerChunk * 1.5 && txLineIndices.length === 0) {
      const chunks: string[] = [];
      for (let i = 0; i < lines.length; i += targetTxLinesPerChunk) {
        chunks.push(lines.slice(i, i + targetTxLinesPerChunk).join("\n"));
      }
      return chunks;
    }
    return [lines.join("\n")];
  }

  // Split lines into chunks of ~targetTxLinesPerChunk transaction lines
  const chunks: string[] = [];
  let currentChunkLines: string[] = [];
  let currentTxCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTx = TX_LINE_REGEX.test(line);

    if (isTx) {
      if (currentTxCount >= targetTxLinesPerChunk) {
        chunks.push(currentChunkLines.join("\n"));
        currentChunkLines = [];
        currentTxCount = 0;
      }
      currentTxCount++;
    }

    currentChunkLines.push(line);
  }

  if (currentChunkLines.length > 0) {
    chunks.push(currentChunkLines.join("\n"));
  }

  return chunks.length > 0 ? chunks : [trimmed];
}

const CLIENT_DEFAULT_RETRY_DELAYS = [2000, 4000, 8000, 16000];

/**
 * Sends a single chunk to /api/parse, retrying up to 4 times with exponential backoff (2s, 4s, 8s, 16s)
 * plus small random jitter on 503, 429, or 500. Does not retry on 400/401/403/404.
 */
export async function parseChunkWithRetry(
  chunkText: string,
  chunkIndex: number,
  onRetry?: (attempt: number, maxRetries: number) => void,
  retryDelays: number[] = CLIENT_DEFAULT_RETRY_DELAYS
): Promise<RawParsedTransaction[]> {
  const maxRetries = retryDelays.length; // 4 retries
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const parseRes = await apiFetch<ParsePageResponse>("/parse", {
        method: "POST",
        body: JSON.stringify({
          text: chunkText,
          pageNumber: chunkIndex + 1,
        }),
      });

      return Array.isArray(parseRes.transactions) ? parseRes.transactions : [];
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const isRetryable = status === 503 || status === 429 || status === 500;
      const isDoNotRetry =
        status === 400 || status === 401 || status === 403 || status === 404;

      if (isDoNotRetry || !isRetryable || attempt >= maxRetries) {
        throw err;
      }

      const retryNumber = attempt + 1; // 1 to 4
      onRetry?.(retryNumber, maxRetries);

      const delayMs = retryDelays[attempt] + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Splits extracted statement pages into chunks of ~30 transaction lines,
 * sends them sequentially to /api/parse (no parallel requests) with a short delay (~500ms)
 * between chunks, and merges the parsed results. Supports resuming from a failed chunk.
 */
export async function parsePagesWithLLM(
  pages: ExtractedPage[],
  onProgress?: (progress: StatementProcessingProgress) => void,
  resumeState?: ParseResumeState,
  options?: {
    chunkDelayMs?: number;
    retryDelays?: number[];
    onSummaryExtracted?: (summary: StatementSummary | null) => void;
  }
): Promise<RawParsedTransaction[]> {
  let chunks: string[];
  let startChunk = 0;
  let allRawTransactions: RawParsedTransaction[] = [];
  let totalPages = pages.length;

  if (resumeState) {
    chunks = resumeState.chunks;
    startChunk = resumeState.startChunkIndex;
    allRawTransactions = [...resumeState.accumulatedTransactions];
    totalPages = resumeState.totalPages ?? (pages.length > 0 ? pages.length : 1);
  } else {
    // Truncate document at summary marker before chunking or calling LLM
    const { truncatedPages, cleanedText } = truncatePagesAtSummaryMarker(pages);
    const nonBlankPages = truncatedPages.filter((p) =>
      (p.redacted?.redactedText || p.rawText || "").trim()
    );
    if (nonBlankPages.length === 0) {
      return [];
    }

    chunks = splitTextIntoTransactionChunks(cleanedText, 30);
    totalPages = truncatedPages.length;
  }

  const totalChunks = chunks.length;
  const chunkDelay = options?.chunkDelayMs ?? 500;
  const retryDelays = options?.retryDelays ?? CLIENT_DEFAULT_RETRY_DELAYS;

  for (let c = startChunk; c < totalChunks; c++) {
    // Process chunks sequentially with short delay (~500ms) between chunks
    if (c > startChunk && chunkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelay));
    }

    const currentChunkNum = c + 1;
    onProgress?.({
      currentPage: Math.min(currentChunkNum, totalPages),
      totalPages,
      currentChunk: currentChunkNum,
      totalChunks,
      stage: "parsing_llm",
      extractedCount: allRawTransactions.length,
      message: `Parsing chunk ${currentChunkNum} of ${totalChunks}`,
    });

    try {
      const txs = await parseChunkWithRetry(
        chunks[c],
        c,
        (retryAttempt, maxRetries) => {
          onProgress?.({
            currentPage: Math.min(currentChunkNum, totalPages),
            totalPages,
            currentChunk: currentChunkNum,
            totalChunks,
            stage: "parsing_llm",
            extractedCount: allRawTransactions.length,
            message: `Model busy, retrying (${retryAttempt}/${maxRetries})`,
          });
        },
        retryDelays
      );
      allRawTransactions.push(...txs);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status ?? 503;
      const message =
        (err as { message?: string })?.message ||
        "The AI model is busy. Please try again in a minute.";

      throw new StatementParsingError(message, {
        status,
        stage: "llm",
        failedChunkIndex: c,
        totalChunks,
        parsedTransactions: allRawTransactions,
        chunks,
      });
    }
  }

  return allRawTransactions;
}

/**
 * Full Pipeline:
 * 1. Opens password-protected PDF in memory
 * 2. Extracts and redacts PII page-by-page
 * 3. Sends redacted text to /api/parse
 * 4. Encrypts resulting transactions with master dataKey (AES-GCM 256)
 * 5. Computes hmacTxHash
 * 6. Saves encrypted transactions to /api/transactions/bulk (skipping duplicates)
 */
export async function processAndUploadStatement(
  fileData: ArrayBuffer | Uint8Array,
  dataKey: CryptoKey,
  options?: {
    password?: string;
    accountId?: string;
    onProgress?: (progress: StatementProcessingProgress) => void;
  }
): Promise<{
  totalExtracted: number;
  insertedCount: number;
  skippedCount: number;
}> {
  const onProgress = options?.onProgress;

  onProgress?.({
    currentPage: 0,
    totalPages: 1,
    stage: "extracting",
    extractedCount: 0,
  });

  const pages = await extractStatementPages(fileData, options?.password);
  const totalPages = pages.length;

  const allRawTransactions = await parsePagesWithLLM(pages, onProgress);

  onProgress?.({
    currentPage: totalPages,
    totalPages,
    stage: "encrypting",
    extractedCount: allRawTransactions.length,
  });

  const bulkRes = await encryptAndSaveTransactions(
    allRawTransactions,
    dataKey,
    options?.accountId
  );

  onProgress?.({
    currentPage: totalPages,
    totalPages,
    stage: "complete",
    extractedCount: allRawTransactions.length,
  });

  return {
    totalExtracted: allRawTransactions.length,
    insertedCount: bulkRes.insertedCount,
    skippedCount: bulkRes.skippedCount,
  };
}
