import React, { useState } from "react";
import { useKeyContext } from "@/context/KeyContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  validateStatementTransactions,
  updateTransactionAndValidate,
  toggleExcludeAndValidate,
  type ValidatedTransaction,
  type ValidationSummary,
  type ParsedTransaction,
} from "@/lib/pdf/validation";
import {
  extractStatementMetadata,
  deriveStatementMetadataFromTransactions,
  type StatementMetadata,
} from "@/lib/pdf/statementMeta";
import { truncatePagesAtSummaryMarker } from "@/lib/pdf/statementSummary";
import {
  extractStatementPages,
  parsePagesWithLLM,
  encryptAndSaveTransactions,
  PdfPasswordRequiredError,
  StatementParsingError,
  type StatementProcessingProgress,
  type RawParsedTransaction,
} from "@/lib/pdf/extractor";
import {
  parseTabularData,
  extractTransactionsFromTabular,
  type BankColumnMapping,
  type TabularParseResult,
} from "@/lib/tabular/parser";
import { saveBankMapping, getBankMapping } from "@/lib/storage/bankMappingStorage";
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  EyeOff,
  Eye,
  Edit2,
  Check,
  X,
  Lock,
  Loader2,
  Building2,
  Calendar,
  Wallet,
  Settings2,
  Sparkles,
  RefreshCw,
} from "lucide-react";

interface UploadPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (stats: { insertedCount: number; skippedCount: number }) => void;
}

export function UploadPreviewModal({ isOpen, onClose, onSuccess }: UploadPreviewModalProps) {
  const { dataKey } = useKeyContext();

  // Wizard / modal steps
  const [step, setStep] = useState<
    "select_file" | "password_prompt" | "confirm_mapping" | "processing" | "preview" | "done"
  >("select_file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Tabular (CSV / XLSX) state
  const [tabularResult, setTabularResult] = useState<TabularParseResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<BankColumnMapping | null>(null);
  const [rememberMapping, setRememberMapping] = useState<boolean>(true);
  const [hasSavedMapping, setHasSavedMapping] = useState<boolean>(false);

  // Processing state
  const [progress, setProgress] = useState<StatementProcessingProgress | null>(null);
  const [processingStageText, setProcessingStageText] = useState("");

  // Extracted data & validation
  const [metadata, setMetadata] = useState<StatementMetadata>({});
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);
  const [activeTab, setActiveTab] = useState<"needs_review" | "all">("needs_review");
  const [failedChunkResumeState, setFailedChunkResumeState] = useState<{
    chunks: string[];
    startChunkIndex: number;
    accumulatedTransactions: RawParsedTransaction[];
    totalPages: number;
    meta: StatementMetadata;
  } | null>(null);

  // Inline editing state: row ID currently being edited
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ParsedTransaction | null>(null);

  // Final submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importStats, setImportStats] = useState<{ insertedCount: number; skippedCount: number } | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep("select_file");
    setSelectedFile(null);
    setPdfPassword("");
    setErrorMessage(null);
    setFailedChunkResumeState(null);
    setTabularResult(null);
    setColumnMapping(null);
    setRememberMapping(true);
    setHasSavedMapping(false);
    setProgress(null);
    setMetadata({});
    setValidationSummary(null);
    setEditingRowId(null);
    setEditForm(null);
    setIsSubmitting(false);
    setImportStats(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Start processing the selected file (detects PDF vs CSV/XLSX)
  const startProcessing = async (file: File, password?: string) => {
    setErrorMessage(null);
    setFailedChunkResumeState(null);

    const isTabular = /\.(csv|xlsx|xls)$/i.test(file.name);

    if (isTabular) {
      setProcessingStageText("Reading and detecting columns in tabular statement...");
      setStep("processing");

      try {
        const buffer = await file.arrayBuffer();
        const parsed = parseTabularData(buffer);
        setTabularResult(parsed);
        setMetadata(parsed.metadata);

        // Check if an encrypted mapping already exists for this bank
        let mappingToUse = parsed.detectedMapping;
        let savedFound = false;

        if (dataKey) {
          const saved = await getBankMapping(parsed.detectedBank, dataKey);
          if (saved) {
            mappingToUse = { ...saved, bank: parsed.detectedBank };
            savedFound = true;
          }
        }

        setColumnMapping(mappingToUse);
        setHasSavedMapping(savedFound);
        setStep("confirm_mapping");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to parse tabular file.");
        setStep("select_file");
      }
      return;
    }

    // PDF Flow
    setStep("processing");
    let currentMeta: StatementMetadata = {};
    let pagesTotal = 1;

    try {
      const buffer = await file.arrayBuffer();

      // Step 1: Extract & Redact text in memory
      setProcessingStageText("Extracting text and redacting PII in browser memory...");
      const rawPages = await extractStatementPages(buffer, password);

      // Truncate document before any metadata extraction or LLM call
      const { truncatedPages, cleanedText } = truncatePagesAtSummaryMarker(rawPages);
      pagesTotal = truncatedPages.length;

      // Extract statement metadata (Bank) from cleaned text
      const meta = extractStatementMetadata(cleanedText);
      currentMeta = meta;
      setMetadata(meta);

      // Step 2: Parse transactions via LLM
      setProcessingStageText("Sending redacted text to secure LLM parsing endpoint...");
      const rawTxs = await parsePagesWithLLM(truncatedPages, (prog) => {
        setProgress(prog);
        if (prog.message) {
          setProcessingStageText(prog.message);
        } else if (prog.currentChunk && prog.totalChunks) {
          setProcessingStageText(
            `Parsing chunk ${prog.currentChunk} of ${prog.totalChunks}`
          );
        } else {
          setProcessingStageText(
            `Parsing page ${prog.currentPage} of ${prog.totalPages} (${prog.extractedCount} txs found)...`
          );
        }
      });

      // Map to parsed transactions with unique ids
      const mappedTxs: ParsedTransaction[] = rawTxs.map((tx, idx) => ({
        id: `tx-${idx}-${Date.now()}`,
        date: tx.date,
        narration: tx.narration,
        type: tx.type,
        amount: tx.amount,
        balance: tx.balance,
        isExcluded: false,
      }));

      // Derive opening balance, closing balance, and period from parsed transaction rows
      const finalMeta = deriveStatementMetadataFromTransactions(mappedTxs, meta);
      setMetadata(finalMeta);

      // Step 3: Validate transactions against metadata & running balance
      const summary = validateStatementTransactions(mappedTxs, finalMeta);
      setValidationSummary(summary);

      if (summary.needsReviewRows > 0) {
        setActiveTab("needs_review");
      } else {
        setActiveTab("all");
      }

      setStep("preview");
    } catch (err: unknown) {
      if (err instanceof PdfPasswordRequiredError) {
        setStep("password_prompt");
      } else if (err instanceof StatementParsingError) {
        setErrorMessage(err.message);
        setFailedChunkResumeState({
          chunks: err.chunks,
          startChunkIndex: err.failedChunkIndex,
          accumulatedTransactions: err.parsedTransactions,
          totalPages: pagesTotal,
          meta: currentMeta,
        });
        setStep("select_file");
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to process statement.");
        setStep("select_file");
      }
    }
  };

  // Resume PDF parsing from failed chunk
  const handleResumeModalParse = async () => {
    if (!failedChunkResumeState) return;

    setStep("processing");
    setErrorMessage(null);

    const { chunks, startChunkIndex, accumulatedTransactions, totalPages, meta } =
      failedChunkResumeState;

    try {
      setProcessingStageText(
        `Resuming from chunk ${startChunkIndex + 1} of ${chunks.length}...`
      );

      const rawTxs = await parsePagesWithLLM(
        [],
        (prog) => {
          setProgress(prog);
          if (prog.message) {
            setProcessingStageText(prog.message);
          } else if (prog.currentChunk && prog.totalChunks) {
            setProcessingStageText(
              `Parsing chunk ${prog.currentChunk} of ${prog.totalChunks}`
            );
          }
        },
        {
          chunks,
          startChunkIndex,
          accumulatedTransactions,
          totalPages,
        }
      );

      setFailedChunkResumeState(null);

      const mappedTxs: ParsedTransaction[] = rawTxs.map((tx, idx) => ({
        id: `tx-${idx}-${Date.now()}`,
        date: tx.date,
        narration: tx.narration,
        type: tx.type,
        amount: tx.amount,
        balance: tx.balance,
        isExcluded: false,
      }));

      const finalMeta = deriveStatementMetadataFromTransactions(mappedTxs, meta);
      setMetadata(finalMeta);

      const summary = validateStatementTransactions(mappedTxs, finalMeta);
      setValidationSummary(summary);

      if (summary.needsReviewRows > 0) {
        setActiveTab("needs_review");
      } else {
        setActiveTab("all");
      }

      setStep("preview");
    } catch (err: unknown) {
      if (err instanceof StatementParsingError) {
        setErrorMessage(err.message);
        setFailedChunkResumeState({
          chunks: err.chunks,
          startChunkIndex: err.failedChunkIndex,
          accumulatedTransactions: err.parsedTransactions,
          totalPages,
          meta,
        });
        setStep("select_file");
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to process statement.");
        setStep("select_file");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      startProcessing(file);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFile) {
      startProcessing(selectedFile, pdfPassword);
    }
  };

  // Confirm Column Mapping & Run Validation (CSV/XLSX)
  const handleConfirmMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tabularResult || !columnMapping) return;

    setStep("processing");
    setProcessingStageText("Extracting and validating rows from tabular statement...");

    try {
      // 1. Save mapping encrypted with master key if requested
      if (rememberMapping && dataKey && columnMapping.bank) {
        await saveBankMapping(columnMapping.bank, columnMapping, dataKey);
      }

      // 2. Extract rows using confirmed mapping
      const txs = extractTransactionsFromTabular(
        tabularResult.rawRows,
        tabularResult.headerRowIndex,
        columnMapping
      );

      if (txs.length === 0) {
        throw new Error(
          "No valid transaction rows found with the selected column mapping. Please review your column assignments."
        );
      }

      // 3. Reuse identical validation flow
      const summary = validateStatementTransactions(txs, metadata);
      setValidationSummary(summary);

      if (summary.needsReviewRows > 0) {
        setActiveTab("needs_review");
      } else {
        setActiveTab("all");
      }

      setStep("preview");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to apply column mapping.");
      setStep("confirm_mapping");
    }
  };

  // Inline edit handlers
  const startEditRow = (row: ValidatedTransaction) => {
    setEditingRowId(row.id);
    setEditForm({
      id: row.id,
      date: row.date,
      narration: row.narration,
      type: row.type,
      amount: row.amount,
      balance: row.balance,
      isExcluded: row.isExcluded,
    });
  };

  const cancelEditRow = () => {
    setEditingRowId(null);
    setEditForm(null);
  };

  const saveEditRow = () => {
    if (!editForm || !validationSummary) return;

    const updated = updateTransactionAndValidate(
      validationSummary.transactions,
      editForm,
      metadata
    );

    setValidationSummary(updated);
    setEditingRowId(null);
    setEditForm(null);
  };

  const toggleExcludeRow = (rowId: string) => {
    if (!validationSummary) return;

    const updated = toggleExcludeAndValidate(
      validationSummary.transactions,
      rowId,
      metadata
    );

    setValidationSummary(updated);
  };

  const excludeAllNeedsReview = () => {
    if (!validationSummary) return;

    const updatedTxs = validationSummary.transactions.map((tx) =>
      tx.status === "needs_review" ? { ...tx, isExcluded: true } : tx
    );

    const updated = validateStatementTransactions(updatedTxs, metadata);
    setValidationSummary(updated);
  };

  // Final Import
  const handleImport = async () => {
    if (!validationSummary || !dataKey) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await encryptAndSaveTransactions(
        validationSummary.transactions,
        dataKey
      );

      setImportStats(res);
      setStep("done");
      onSuccess?.(res);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to import transactions.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <Card className="w-full max-w-4xl border-border bg-[#0C0E10] text-foreground shadow-2xl my-8">
        {/* Step 1: File Selection */}
        {step === "select_file" && (
          <>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-foreground" />
                  Import Bank Statement (PDF, CSV, XLSX)
                </CardTitle>
                <button
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  ✕
                </button>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Supported formats: <span className="text-foreground font-mono font-medium">PDF, CSV, Excel (.xlsx, .xls)</span>.
                Primary banks: <span className="text-foreground font-mono font-medium">HDFC, ICICI, SBI</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMessage && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                  {failedChunkResumeState && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleResumeModalParse}
                      className="gap-1.5 h-7 text-xs bg-trend-red text-background hover:bg-trend-red/90 shrink-0 self-end sm:self-auto font-medium"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Retry from chunk {failedChunkResumeState.startChunkIndex + 1} of {failedChunkResumeState.chunks.length}</span>
                    </Button>
                  )}
                </div>
              )}

              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-10 cursor-pointer hover:border-foreground/50 hover:bg-card/50 transition">
                <div className="flex items-center gap-3 mb-3">
                  <FileSpreadsheet className="h-9 w-9 text-trend-green" />
                  <span className="text-muted-foreground text-xl">/</span>
                  <FileText className="h-9 w-9 text-foreground" />
                </div>
                <span className="text-sm font-medium text-foreground">Select Statement File</span>
                <span className="text-xs text-muted-foreground mt-1">
                  Upload CSV, Excel (.xlsx/.xls) or PDF bank statement
                </span>
                <input
                  type="file"
                  accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              <div className="p-3 bg-card border border-gridline rounded text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">Zero-Knowledge & Intelligent Mapping:</p>
                <p>• <strong>CSV/XLSX:</strong> Auto-detects columns (Date, Description, Debit/Credit, Balance), lets you confirm mapping once per bank, and saves the mapping encrypted.</p>
                <p>• <strong>PDF:</strong> Decrypted and PII-redacted in browser memory before secure parsing.</p>
                <p>• <strong>Verification:</strong> Mathematical balance chain, opening/closing boundaries, and dates are checked before encryption.</p>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="outline" size="sm" onClick={handleClose}>
                Cancel
              </Button>
            </CardFooter>
          </>
        )}

        {/* Step 2: Password Prompt (PDF) */}
        {step === "password_prompt" && (
          <form onSubmit={handlePasswordSubmit}>
            <CardHeader>
              <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                <Lock className="h-5 w-5 text-foreground" />
                Password Protected PDF
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                This bank statement requires a password to decrypt. The password is kept in browser
                memory only and never logged or transmitted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Statement Password</label>
                <input
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="e.g. DOB, PAN, or custom statement password"
                  autoFocus
                  required
                  className="w-full px-3 py-2 text-sm bg-card border border-border rounded text-foreground focus:outline-none focus:border-foreground"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep("select_file")}>
                Back
              </Button>
              <Button size="sm" type="submit">
                Decrypt & Process
              </Button>
            </CardFooter>
          </form>
        )}

        {/* Step 2.5: Confirm Column Mapping (CSV / XLSX) */}
        {step === "confirm_mapping" && tabularResult && columnMapping && (
          <form onSubmit={handleConfirmMapping}>
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                    <Settings2 className="h-5 w-5 text-foreground" />
                    Confirm Column Mapping ({tabularResult.detectedBank})
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Columns were detected by header name. Confirm the mapping once per bank to save it encrypted.
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  ✕
                </button>
              </div>

              {hasSavedMapping && (
                <div className="mt-2 p-2.5 rounded bg-trend-green/10 border border-trend-green/30 text-trend-green text-xs flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span>
                    Loaded previously saved encrypted column mapping for <strong>{columnMapping.bank}</strong>.
                  </span>
                </div>
              )}
            </CardHeader>

            <CardContent className="p-4 space-y-4 max-h-[420px] overflow-y-auto">
              {errorMessage && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                  {errorMessage}
                </div>
              )}

              {/* Bank Name Field */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Bank Identity</label>
                  <input
                    type="text"
                    value={columnMapping.bank}
                    onChange={(e) => setColumnMapping({ ...columnMapping, bank: e.target.value })}
                    required
                    placeholder="e.g. HDFC, ICICI, SBI, Axis"
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Date Column *</label>
                  <select
                    value={columnMapping.dateColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, dateColumn: e.target.value })}
                    required
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  >
                    <option value="">-- Select Date Column --</option>
                    {tabularResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Narration and Balance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Narration / Description Column *</label>
                  <select
                    value={columnMapping.narrationColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, narrationColumn: e.target.value })}
                    required
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  >
                    <option value="">-- Select Narration Column --</option>
                    {tabularResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Running Balance Column *</label>
                  <select
                    value={columnMapping.balanceColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, balanceColumn: e.target.value })}
                    required
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  >
                    <option value="">-- Select Balance Column --</option>
                    {tabularResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Debit & Credit Columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Debit / Withdrawal Column</label>
                  <select
                    value={columnMapping.debitColumn || ""}
                    onChange={(e) => setColumnMapping({ ...columnMapping, debitColumn: e.target.value || undefined })}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  >
                    <option value="">-- None / Separate Amount Column --</option>
                    {tabularResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Credit / Deposit Column</label>
                  <select
                    value={columnMapping.creditColumn || ""}
                    onChange={(e) => setColumnMapping({ ...columnMapping, creditColumn: e.target.value || undefined })}
                    className="w-full px-3 py-1.5 text-xs bg-card border border-border rounded text-foreground font-mono"
                  >
                    <option value="">-- None / Separate Amount Column --</option>
                    {tabularResult.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Remember mapping checkbox */}
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={rememberMapping}
                    onChange={(e) => setRememberMapping(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span>Save and encrypt this mapping for {columnMapping.bank || "this bank"}</span>
                </label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  AES-GCM 256 zero-knowledge storage
                </span>
              </div>
            </CardContent>

            <CardFooter className="justify-between border-t border-border pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep("select_file")}>
                Back
              </Button>
              <Button size="sm" type="submit" className="gap-2">
                <Check className="h-4 w-4" />
                Confirm & Validate Transactions
              </Button>
            </CardFooter>
          </form>
        )}

        {/* Step 3: Processing */}
        {step === "processing" && (
          <CardContent className="py-16 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{processingStageText}</p>
              {progress && (
                <p className="text-xs text-muted-foreground font-mono">
                  {progress.currentChunk && progress.totalChunks
                    ? `Chunk ${progress.currentChunk} / ${progress.totalChunks}`
                    : `Page ${progress.currentPage} / ${progress.totalPages}`}
                </p>
              )}
            </div>
          </CardContent>
        )}

        {/* Step 4: Preview & Review */}
        {step === "preview" && validationSummary && (
          <>
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5 text-foreground" />
                    Statement Upload Preview & Validation
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Review extracted transactions, math validation, and boundary balance checks.
                  </CardDescription>
                </div>
                <button
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  ✕
                </button>
              </div>

              {/* Statement Metadata Summary Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 text-xs">
                <div className="p-2 rounded bg-card border border-border flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-foreground/70 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground block">Bank</span>
                    <span className="font-mono font-medium text-foreground">
                      {metadata.bank || columnMapping?.bank || "Unknown Bank"}
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded bg-card border border-border flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-foreground/70 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground block">Period</span>
                    <span className="font-mono text-foreground">
                      {metadata.startDate || "..."} to {metadata.endDate || "..."}
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded bg-card border border-border flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-foreground/70 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground block">Opening Balance</span>
                    <span className="font-mono text-foreground">
                      {metadata.openingBalance !== undefined
                        ? `₹${metadata.openingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "N/A"}
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded bg-card border border-border flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-foreground/70 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase text-muted-foreground block">Closing Balance</span>
                    <span className="font-mono text-foreground">
                      {metadata.closingBalance !== undefined
                        ? `₹${metadata.closingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Statement Reconciliation Banner / Badge */}
              {validationSummary.reconciliation && (
                validationSummary.reconciliation.isReconciled ? (
                  <div className="mt-3 p-2.5 rounded bg-trend-green/10 border border-trend-green/30 flex items-center justify-between text-xs text-trend-green">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="px-2 py-0.5 rounded bg-trend-green text-background text-[10px] font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Statement reconciled
                      </span>
                      <span>All opening/closing balances, Dr/Cr counts, and totals match the statement summary.</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                      {validationSummary.reconciliation.summary.drCount} DR | {validationSummary.reconciliation.summary.crCount} CR
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 p-2.5 bg-trend-red/10 border border-trend-red/30 rounded text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5 font-medium text-trend-red">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-semibold">Statement Reconciliation Mismatches ({validationSummary.reconciliation.mismatches.length}):</span>
                    </div>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-4 list-disc text-muted-foreground text-[11px]">
                      {validationSummary.reconciliation.mismatches.map((m, idx) => (
                        <li key={idx}>
                          <strong className="text-foreground">{m.label}:</strong> {m.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              {/* Tab Navigation & Row Counters */}
              <div className="flex items-center justify-between pt-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("needs_review")}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                      activeTab === "needs_review"
                        ? "bg-foreground text-background"
                        : "bg-nav-active text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Needs Review ({validationSummary.needsReviewRows})</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("all")}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                      activeTab === "all"
                        ? "bg-foreground text-background"
                        : "bg-nav-active text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>All Rows ({validationSummary.totalRows})</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-trend-green">
                    Valid: {validationSummary.validRows}
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span className={validationSummary.needsReviewRows > 0 ? "text-trend-red font-semibold" : "text-muted-foreground"}>
                    Issues: {validationSummary.needsReviewRows}
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-muted-foreground">
                    Excluded: {validationSummary.excludedRows}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 max-h-[420px] overflow-y-auto space-y-3">
              {errorMessage && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                  {errorMessage}
                </div>
              )}

              {/* TAB 1: NEEDS REVIEW */}
              {activeTab === "needs_review" && (
                <div className="space-y-3">
                  {validationSummary.needsReviewRows === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-trend-green mx-auto mb-2" />
                      <p className="text-foreground font-medium">No rows require review!</p>
                      <p className="mt-1">All mathematical balances, boundaries, and dates are verified.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between bg-card p-2.5 rounded border border-border text-xs">
                        <span className="text-muted-foreground">
                          {validationSummary.needsReviewRows} row(s) failed balance math or date validation. You can edit their values or exclude them.
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={excludeAllNeedsReview}
                          className="h-7 text-[11px] gap-1"
                        >
                          <EyeOff className="h-3 w-3" />
                          Exclude All Issues
                        </Button>
                      </div>

                      {validationSummary.transactions
                        .filter((tx) => tx.status === "needs_review")
                        .map((tx) => (
                          <div
                            key={tx.id}
                            className="p-3 bg-card border border-trend-red/40 rounded-lg space-y-2"
                          >
                            {/* Validation Issue Badges */}
                            <div className="space-y-1">
                              {tx.issues.map((issue, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-1.5 text-xs text-trend-red bg-trend-red/10 px-2 py-1 rounded"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span>{issue.message}</span>
                                </div>
                              ))}
                            </div>

                            {/* Editing Form vs Display */}
                            {editingRowId === tx.id && editForm ? (
                              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-border">
                                <div>
                                  <label className="text-[10px] text-muted-foreground block mb-0.5">Date</label>
                                  <input
                                    type="text"
                                    value={editForm.date}
                                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                    className="w-full px-2 py-1 text-xs bg-background border border-border rounded font-mono"
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className="text-[10px] text-muted-foreground block mb-0.5">Narration</label>
                                  <input
                                    type="text"
                                    value={editForm.narration}
                                    onChange={(e) => setEditForm({ ...editForm, narration: e.target.value })}
                                    className="w-full px-2 py-1 text-xs bg-background border border-border rounded"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground block mb-0.5">Type & Amount</label>
                                  <div className="flex gap-1">
                                    <select
                                      value={editForm.type}
                                      onChange={(e) =>
                                        setEditForm({
                                          ...editForm,
                                          type: e.target.value as "debit" | "credit",
                                        })
                                      }
                                      className="px-1 py-1 text-xs bg-background border border-border rounded uppercase text-[10px]"
                                    >
                                      <option value="debit">DR</option>
                                      <option value="credit">CR</option>
                                    </select>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editForm.amount}
                                      onChange={(e) =>
                                        setEditForm({
                                          ...editForm,
                                          amount: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      className="w-full px-2 py-1 text-xs bg-background border border-border rounded font-mono"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground block mb-0.5">Balance</label>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editForm.balance}
                                      onChange={(e) =>
                                        setEditForm({
                                          ...editForm,
                                          balance: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                      className="w-full px-2 py-1 text-xs bg-background border border-border rounded font-mono"
                                    />
                                    <Button
                                      size="sm"
                                      onClick={saveEditRow}
                                      className="h-7 w-7 p-0 shrink-0 bg-trend-green text-background hover:bg-trend-green/90"
                                      title="Save Edits"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={cancelEditRow}
                                      className="h-7 w-7 p-0 shrink-0 text-muted-foreground"
                                      title="Cancel"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 gap-2 text-xs">
                                <div className="space-y-0.5">
                                  <div className="font-mono text-foreground flex items-center gap-2">
                                    <span>{tx.date}</span>
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-mono ${
                                        tx.type === "credit"
                                          ? "bg-trend-green/10 text-trend-green"
                                          : "bg-trend-red/10 text-trend-red"
                                      }`}
                                    >
                                      {tx.type} ₹{tx.amount.toFixed(2)}
                                    </span>
                                    <span className="text-muted-foreground text-[11px]">
                                      Balance: ₹{tx.balance.toFixed(2)}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground truncate max-w-lg">{tx.narration}</p>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => startEditRow(tx)}
                                    className="h-7 text-xs gap-1"
                                  >
                                    <Edit2 className="h-3 w-3" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => toggleExcludeRow(tx.id)}
                                    className="h-7 text-xs text-muted-foreground hover:text-trend-red gap-1"
                                  >
                                    <EyeOff className="h-3 w-3" />
                                    Exclude
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                    </>
                  )}
                </div>
              )}

              {/* TAB 2: ALL TRANSACTIONS TABLE */}
              {activeTab === "all" && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-card border-b border-border text-muted-foreground text-[11px] uppercase">
                      <tr>
                        <th className="p-2.5 font-medium">Status</th>
                        <th className="p-2.5 font-medium">Date</th>
                        <th className="p-2.5 font-medium">Narration</th>
                        <th className="p-2.5 font-medium">Type</th>
                        <th className="p-2.5 font-medium text-right">Amount</th>
                        <th className="p-2.5 font-medium text-right">Balance</th>
                        <th className="p-2.5 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gridline">
                      {validationSummary.transactions.map((tx) => (
                        <tr
                          key={tx.id}
                          className={`hover:bg-card/50 transition ${
                            tx.status === "excluded"
                              ? "opacity-40 line-through"
                              : tx.status === "needs_review"
                              ? "bg-trend-red/5"
                              : ""
                          }`}
                        >
                          <td className="p-2.5 whitespace-nowrap">
                            {tx.status === "valid" ? (
                              <span className="inline-flex items-center gap-1 text-trend-green font-mono text-[11px]">
                                <CheckCircle2 className="h-3 w-3" /> Valid
                              </span>
                            ) : tx.status === "needs_review" ? (
                              <span className="inline-flex items-center gap-1 text-trend-red font-mono text-[11px]">
                                <AlertTriangle className="h-3 w-3" /> Review
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground font-mono text-[11px]">
                                <XCircle className="h-3 w-3" /> Excluded
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 font-mono whitespace-nowrap">{tx.date}</td>
                          <td className="p-2.5 max-w-xs truncate text-foreground/90" title={tx.narration}>
                            {tx.narration}
                          </td>
                          <td className="p-2.5 uppercase font-mono text-[10px]">
                            <span
                              className={`px-1.5 py-0.5 rounded ${
                                tx.type === "credit"
                                  ? "bg-trend-green/10 text-trend-green"
                                  : "bg-trend-red/10 text-trend-red"
                              }`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-mono font-medium">
                            ₹{tx.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2.5 text-right font-mono text-muted-foreground">
                            ₹{tx.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditRow(tx)}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                title="Edit Row"
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toggleExcludeRow(tx.id)}
                                className={`h-6 w-6 p-0 ${
                                  tx.isExcluded ? "text-trend-green" : "text-muted-foreground hover:text-trend-red"
                                }`}
                                title={tx.isExcluded ? "Include Row" : "Exclude Row"}
                              >
                                {tx.isExcluded ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>

            <CardFooter className="justify-between border-t border-border pt-3">
              <Button variant="outline" size="sm" onClick={resetState}>
                Upload Another Statement
              </Button>

              <div className="flex items-center gap-3">
                {validationSummary.needsReviewRows > 0 ? (
                  <div className="text-xs text-trend-red flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Resolve or exclude {validationSummary.needsReviewRows} issue(s) before importing</span>
                  </div>
                ) : (
                  <div className="text-xs text-trend-green flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>All {validationSummary.validRows} rows verified</span>
                  </div>
                )}

                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={isSubmitting || validationSummary.validRows === 0 || validationSummary.needsReviewRows > 0}
                  className="gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Encrypting & Saving...
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Import {validationSummary.validRows} Transactions
                    </>
                  )}
                </Button>
              </div>
            </CardFooter>
          </>
        )}

        {/* Step 5: Done */}
        {step === "done" && importStats && (
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle2 className="h-10 w-10 text-trend-green mx-auto" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">Statement Import Successful!</h3>
              <p className="text-xs text-muted-foreground">
                Transactions have been encrypted with your in-memory AES-GCM 256 master key and stored.
              </p>
            </div>
            <div className="inline-flex items-center gap-4 p-3 bg-card border border-border rounded font-mono text-xs">
              <span className="text-trend-green">Inserted: {importStats.insertedCount}</span>
              <span className="text-muted-foreground">Duplicates Skipped: {importStats.skippedCount}</span>
            </div>
            <div>
              <Button size="sm" onClick={handleClose}>
                Done
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
