import React, { useState } from "react";
import { Link } from "react-router-dom";
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
  extractStatementPages,
  parsePagesWithLLM,
  PdfPasswordRequiredError,
  StatementParsingError,
  type StatementProcessingProgress,
  type RawParsedTransaction,
} from "@/lib/pdf/extractor";
import {
  extractStatementMetadata,
  deriveStatementMetadataFromTransactions,
  type StatementMetadata,
} from "@/lib/pdf/statementMeta";
import { truncatePagesAtSummaryMarker } from "@/lib/pdf/statementSummary";
import {
  validateStatementTransactions,
  updateTransactionAndValidate,
  toggleExcludeAndValidate,
  type ValidatedTransaction,
  type ValidationSummary,
  type ParsedTransaction,
} from "@/lib/pdf/validation";
import {
  computeHashesAndCheckDuplicates,
  uploadOnlyNewTransactions,
  type ReviewableTransaction,
} from "@/lib/transactions/uploadPipeline";
import {
  UploadCloud,
  FileText,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Edit2,
  Check,
  X,
  Loader2,
  Building2,
  Calendar,
  Wallet,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

type SupportedBank = "HDFC" | "ICICI" | "SBI" | "AUTO";

export function UploadPage() {
  const { user, dataKey, isLocked } = useKeyContext();

  // 1. Bank selection
  const [selectedBank, setSelectedBank] = useState<SupportedBank>("AUTO");

  // 2. File and password
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // 3. Progress and stage
  const [isParsing, setIsParsing] = useState(false);
  const [progressStage, setProgressStage] = useState<string>("");
  const [pdfProgress, setPdfProgress] = useState<StatementProcessingProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedChunkResumeState, setFailedChunkResumeState] = useState<{
    chunks: string[];
    startChunkIndex: number;
    accumulatedTransactions: RawParsedTransaction[];
    totalPages: number;
    extractedMeta: StatementMetadata;
  } | null>(null);

  // 4. Parsed & validated data
  const [metadata, setMetadata] = useState<StatementMetadata>({});
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);
  const [reviewableTxs, setReviewableTxs] = useState<ReviewableTransaction[]>([]);
  const [newCount, setNewCount] = useState<number>(0);
  const [duplicateCount, setDuplicateCount] = useState<number>(0);

  // 5. Active table filter
  const [tableFilter, setTableFilter] = useState<"all" | "new" | "duplicates" | "needs_review">("all");

  // 6. Inline editing state
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ParsedTransaction | null>(null);

  // 7. Uploading state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCompleteStats, setUploadCompleteStats] = useState<{
    insertedCount: number;
    skippedCount: number;
    total: number;
  } | null>(null);

  // Helper to re-annotate hashes and duplicate status
  const refreshHashesAndDuplicates = async (
    validatedList: ValidatedTransaction[],
    activeKey: CryptoKey
  ) => {
    const hashRes = await computeHashesAndCheckDuplicates(validatedList, activeKey);
    setReviewableTxs(hashRes.annotated);
    setNewCount(hashRes.newCount);
    setDuplicateCount(hashRes.duplicateCount);
  };

  // Trigger parsing pipeline
  const handleStartParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !dataKey) return;

    setIsParsing(true);
    setErrorMessage(null);
    setFailedChunkResumeState(null);
    setUploadCompleteStats(null);

    let currentMeta: StatementMetadata = {};
    let pagesTotal = 1;

    try {
      const buffer = await file.arrayBuffer();

      // Stage 1: Extract & Redact in memory
      setProgressStage("Extracting text and redacting PII locally in memory...");
      const rawPages = await extractStatementPages(buffer, pdfPassword || undefined);

      // Truncate document before any metadata extraction or LLM call
      const { truncatedPages, cleanedText } = truncatePagesAtSummaryMarker(rawPages);
      pagesTotal = truncatedPages.length;

      // Extract statement metadata (bank) from cleaned text
      const extractedMeta = extractStatementMetadata(cleanedText);
      if (selectedBank !== "AUTO" && !extractedMeta.bank) {
        extractedMeta.bank = selectedBank;
      }
      currentMeta = extractedMeta;
      setMetadata(extractedMeta);

      // Stage 2: Send redacted text to LLM
      setProgressStage("Parsing transactions via secure zero-logging LLM...");
      const rawTxs = await parsePagesWithLLM(truncatedPages, (prog) => {
        setPdfProgress(prog);
        if (prog.message) {
          setProgressStage(prog.message);
        } else if (prog.currentChunk && prog.totalChunks) {
          setProgressStage(
            `Parsing chunk ${prog.currentChunk} of ${prog.totalChunks}`
          );
        } else {
          setProgressStage(
            `Parsing page ${prog.currentPage} of ${prog.totalPages} (${prog.extractedCount} txs found)...`
          );
        }
      });

      if (rawTxs.length === 0) {
        throw new Error("No transactions were found in this statement.");
      }

      // Stage 3: Mathematical & Boundary Validation
      setProgressStage("Validating running balance math, boundaries, and dates...");
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
      const finalMeta = deriveStatementMetadataFromTransactions(mappedTxs, extractedMeta);
      setMetadata(finalMeta);

      const summary = validateStatementTransactions(mappedTxs, finalMeta);
      setValidationSummary(summary);

      // Stage 4: Compute txHash for each & query existing hashes
      setProgressStage("Computing HMAC txHashes and checking for duplicates...");
      await refreshHashesAndDuplicates(summary.transactions, dataKey);

      if (summary.needsReviewRows > 0) {
        setTableFilter("needs_review");
      } else {
        setTableFilter("all");
      }
    } catch (err: unknown) {
      if (err instanceof PdfPasswordRequiredError) {
        setErrorMessage(
          "This statement is password protected. Please enter the password above and try again."
        );
      } else if (err instanceof StatementParsingError) {
        setErrorMessage(err.message);
        setFailedChunkResumeState({
          chunks: err.chunks,
          startChunkIndex: err.failedChunkIndex,
          accumulatedTransactions: err.parsedTransactions,
          totalPages: pagesTotal,
          extractedMeta: currentMeta,
        });
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to parse statement.");
      }
    } finally {
      setIsParsing(false);
      setProgressStage("");
    }
  };

  // Resume parsing from failed chunk
  const handleResumeParse = async () => {
    if (!failedChunkResumeState || !dataKey) return;

    setIsParsing(true);
    setErrorMessage(null);
    setUploadCompleteStats(null);

    const { chunks, startChunkIndex, accumulatedTransactions, totalPages, extractedMeta } =
      failedChunkResumeState;

    try {
      setProgressStage(
        `Resuming from chunk ${startChunkIndex + 1} of ${chunks.length}...`
      );

      const rawTxs = await parsePagesWithLLM(
        [],
        (prog) => {
          setPdfProgress(prog);
          if (prog.message) {
            setProgressStage(prog.message);
          } else if (prog.currentChunk && prog.totalChunks) {
            setProgressStage(
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

      if (rawTxs.length === 0) {
        throw new Error("No transactions were found in this statement.");
      }

      setFailedChunkResumeState(null);

      // Stage 3: Mathematical & Boundary Validation
      setProgressStage("Validating running balance math, boundaries, and dates...");
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
      const finalMeta = deriveStatementMetadataFromTransactions(mappedTxs, extractedMeta);
      setMetadata(finalMeta);

      const summary = validateStatementTransactions(mappedTxs, finalMeta);
      setValidationSummary(summary);

      // Stage 4: Compute txHash for each & query existing hashes
      setProgressStage("Computing HMAC txHashes and checking for duplicates...");
      await refreshHashesAndDuplicates(summary.transactions, dataKey);

      if (summary.needsReviewRows > 0) {
        setTableFilter("needs_review");
      } else {
        setTableFilter("all");
      }
    } catch (err: unknown) {
      if (err instanceof StatementParsingError) {
        setErrorMessage(err.message);
        setFailedChunkResumeState({
          chunks: err.chunks,
          startChunkIndex: err.failedChunkIndex,
          accumulatedTransactions: err.parsedTransactions,
          totalPages,
          extractedMeta,
        });
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to parse statement.");
      }
    } finally {
      setIsParsing(false);
      setProgressStage("");
    }
  };

  // Inline editing handlers
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

  const saveEditRow = async () => {
    if (!editForm || !validationSummary || !dataKey) return;

    const updated = updateTransactionAndValidate(
      validationSummary.transactions,
      editForm,
      metadata
    );

    setValidationSummary(updated);
    setEditingRowId(null);
    setEditForm(null);

    await refreshHashesAndDuplicates(updated.transactions, dataKey);
  };

  const toggleExcludeRow = async (rowId: string) => {
    if (!validationSummary || !dataKey) return;

    const updated = toggleExcludeAndValidate(
      validationSummary.transactions,
      rowId,
      metadata
    );

    setValidationSummary(updated);
    await refreshHashesAndDuplicates(updated.transactions, dataKey);
  };

  const excludeAllNeedsReview = async () => {
    if (!validationSummary || !dataKey) return;

    const updatedTxs = validationSummary.transactions.map((tx) =>
      tx.status === "needs_review" ? { ...tx, isExcluded: true } : tx
    );

    const updated = validateStatementTransactions(updatedTxs, metadata);
    setValidationSummary(updated);
    await refreshHashesAndDuplicates(updated.transactions, dataKey);
  };

  // Encrypt and bulk upload ONLY new transactions
  const handleUploadNewTransactions = async () => {
    if (!dataKey || reviewableTxs.length === 0) return;

    setIsUploading(true);
    setErrorMessage(null);

    try {
      const res = await uploadOnlyNewTransactions(reviewableTxs, dataKey);
      setUploadCompleteStats(res);

      // Re-query hashes after upload so they now reflect as duplicates
      if (validationSummary) {
        await refreshHashesAndDuplicates(validationSummary.transactions, dataKey);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to encrypt and upload transactions."
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Reset page
  const handleReset = () => {
    setFile(null);
    setPdfPassword("");
    setMetadata({});
    setValidationSummary(null);
    setReviewableTxs([]);
    setNewCount(0);
    setDuplicateCount(0);
    setErrorMessage(null);
    setFailedChunkResumeState(null);
    setUploadCompleteStats(null);
  };

  // Filtered view of transactions
  const filteredTxs = reviewableTxs.filter((tx) => {
    if (tableFilter === "new") return !tx.isDuplicate && !tx.isExcluded && tx.status !== "needs_review";
    if (tableFilter === "duplicates") return tx.isDuplicate && !tx.isExcluded;
    if (tableFilter === "needs_review") return tx.status === "needs_review" && !tx.isExcluded;
    return true; // 'all'
  });

  if (!user || isLocked || !dataKey) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Card className="border-border bg-card text-foreground">
          <CardHeader className="text-center">
            <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <CardTitle className="text-lg">Vault is Locked</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Your derived AES-GCM 256 master key is not in browser memory. Please unlock your vault
              using your Secret Key to parse statements and encrypt financial records.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Link to="/">
              <Button size="sm">Go to Dashboard to Unlock</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-foreground" />
            Statement Upload & Verification
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose bank, pick statement PDF, parse, review mathematical balance checks, and upload new records.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-trend-green bg-trend-green/10 border border-trend-green/30 px-3 py-1 rounded">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>ZERO-KNOWLEDGE ACTIVE</span>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-trend-red/10 border border-trend-red/30 text-trend-red text-xs rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {failedChunkResumeState && (
            <Button
              type="button"
              size="sm"
              onClick={handleResumeParse}
              disabled={isParsing}
              className="gap-1.5 h-8 text-xs bg-trend-red text-background hover:bg-trend-red/90 shrink-0 self-end sm:self-auto font-medium"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isParsing ? "animate-spin" : ""}`} />
              <span>Retry from chunk {failedChunkResumeState.startChunkIndex + 1} of {failedChunkResumeState.chunks.length}</span>
            </Button>
          )}
        </div>
      )}

      {/* STEP 1: Upload & Parse Form */}
      {!validationSummary && (
        <form onSubmit={handleStartParse} className="space-y-6">
          {/* Bank Choice */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                1. Select Bank Layout
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Optimizes parser and metadata extraction for your bank's specific format.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: "AUTO", label: "Auto Detect", desc: "Scan headers & layout" },
                  { id: "HDFC", label: "HDFC Bank", desc: "HDFC savings/current" },
                  { id: "ICICI", label: "ICICI Bank", desc: "ICICI statement layout" },
                  { id: "SBI", label: "State Bank of India", desc: "SBI B/F & C/F layout" },
                ].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBank(b.id as SupportedBank)}
                    className={`p-3 rounded-lg border text-left transition ${
                      selectedBank === b.id
                        ? "border-foreground bg-nav-active text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                    }`}
                  >
                    <div className="text-xs font-semibold">{b.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{b.desc}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* PDF File Picker & Password */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  2. Pick Statement File
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Select a password-protected or unencrypted statement PDF.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:border-foreground/50 hover:bg-background/50 transition">
                  <FileText className="h-8 w-8 text-muted-foreground mb-2" />
                  {file ? (
                    <div className="text-center">
                      <p className="text-xs font-medium text-foreground truncate max-w-xs">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB (Click to change)
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-xs font-medium text-foreground">Click to select statement PDF</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">or drag and drop file here</p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  3. Enter PDF Password (If Protected)
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Decrypted in local browser RAM only. Never stored or sent to any server.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">PDF Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={pdfPassword}
                      onChange={(e) => setPdfPassword(e.target.value)}
                      placeholder="e.g. DOB (DDMMYYYY) or PAN"
                      className="w-full px-3 py-2 pr-9 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-2.5 bg-background border border-gridline rounded text-[11px] text-muted-foreground space-y-0.5">
                  <p className="text-foreground font-medium">Privacy Assertion:</p>
                  <p>• PDF text is extracted and redacted via regex before sending to LLM.</p>
                  <p>• Master data key encrypts rows before saving to database.</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Button & Live Progress */}
          <div className="flex flex-col items-end gap-2">
            <Button
              type="submit"
              disabled={!file || isParsing}
              className="gap-2 px-6 h-10 text-xs"
            >
              {isParsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing Statement...</span>
                </>
              ) : (
                <>
                  <span>Parse Statement</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            {isParsing && (
              <div className="w-full max-w-md p-3 bg-card border border-border rounded text-xs space-y-1 text-right">
                <p className="text-foreground font-medium">{progressStage}</p>
                {pdfProgress && (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {pdfProgress.currentChunk && pdfProgress.totalChunks
                      ? `Chunk ${pdfProgress.currentChunk} of ${pdfProgress.totalChunks}`
                      : `Page ${pdfProgress.currentPage} of ${pdfProgress.totalPages}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </form>
      )}

      {/* STEP 2: Preview Table, Needs-Review & Deduplication Summary */}
      {validationSummary && (
        <div className="space-y-6">
          {/* Metadata Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-2">
              <Building2 className="h-4 w-4 text-foreground/70 shrink-0" />
              <div>
                <span className="text-[10px] uppercase text-muted-foreground block">Bank</span>
                <span className="font-mono font-medium text-foreground">
                  {metadata.bank || selectedBank}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-2">
              <Calendar className="h-4 w-4 text-foreground/70 shrink-0" />
              <div>
                <span className="text-[10px] uppercase text-muted-foreground block">Period</span>
                <span className="font-mono text-foreground">
                  {metadata.startDate || "..."} to {metadata.endDate || "..."}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-2">
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

            <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-2">
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
              <div className="p-3 bg-trend-green/10 border border-trend-green/30 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-medium text-trend-green">
                  <span className="px-2 py-0.5 rounded bg-trend-green text-background text-[11px] font-semibold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Statement reconciled
                  </span>
                  <span>All opening/closing balances, Dr/Cr counts, and totals match the statement summary.</span>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {validationSummary.reconciliation.summary.drCount} DR (₹{validationSummary.reconciliation.summary.totalDebits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}) | {validationSummary.reconciliation.summary.crCount} CR (₹{validationSummary.reconciliation.summary.totalCredits.toLocaleString("en-IN", { minimumFractionDigits: 2 })})
                </span>
              </div>
            ) : (
              <div className="p-3.5 bg-trend-red/10 border border-trend-red/30 rounded-lg space-y-2 text-xs">
                <div className="flex items-center gap-2 font-medium text-trend-red">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="font-semibold">Statement Reconciliation Mismatches ({validationSummary.reconciliation.mismatches.length}):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  {validationSummary.reconciliation.mismatches.map((m, idx) => (
                    <div key={idx} className="p-2 rounded bg-background/60 border border-trend-red/20 space-y-0.5">
                      <span className="font-semibold text-foreground">{m.label}:</span>
                      <p className="text-muted-foreground">{m.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Deduplication Summary Bar ("X new / Y duplicates") */}
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>Deduplication & Hash Status:</span>
                  <span className="px-2 py-0.5 rounded bg-trend-green/10 text-trend-green border border-trend-green/30 font-mono text-xs">
                    {newCount} New
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span className="px-2 py-0.5 rounded bg-nav-active text-muted-foreground border border-border font-mono text-xs">
                    {duplicateCount} Duplicates
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Hashes computed via client HKDF SHA-256 HMAC. Only the {newCount} new transactions
                  will be encrypted and uploaded.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  className="text-xs h-8"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Upload Another
                </Button>

                <Button
                  size="sm"
                  onClick={handleUploadNewTransactions}
                  disabled={isUploading || newCount === 0 || validationSummary.needsReviewRows > 0}
                  className="gap-2 text-xs h-8 bg-foreground text-background hover:bg-foreground/90 font-medium"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Encrypting & Uploading...
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Encrypt & Upload {newCount} New
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Upload Complete Success Notice */}
          {uploadCompleteStats && (
            <div className="p-4 bg-trend-green/10 border border-trend-green/30 rounded-lg text-xs space-y-1">
              <div className="text-trend-green font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                <span>Upload Complete!</span>
              </div>
              <p className="text-muted-foreground">
                Successfully encrypted and inserted <strong>{uploadCompleteStats.insertedCount}</strong> new transactions.{" "}
                <strong>{uploadCompleteStats.skippedCount}</strong> duplicates were safely skipped.
              </p>
            </div>
          )}

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTableFilter("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  tableFilter === "all"
                    ? "bg-foreground text-background"
                    : "bg-nav-active text-muted-foreground hover:text-foreground"
                }`}
              >
                All Rows ({reviewableTxs.length})
              </button>

              <button
                onClick={() => setTableFilter("new")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  tableFilter === "new"
                    ? "bg-trend-green text-background"
                    : "bg-trend-green/10 text-trend-green border border-trend-green/30"
                }`}
              >
                New ({newCount})
              </button>

              <button
                onClick={() => setTableFilter("duplicates")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  tableFilter === "duplicates"
                    ? "bg-foreground text-background"
                    : "bg-nav-active text-muted-foreground"
                }`}
              >
                Duplicates ({duplicateCount})
              </button>

              <button
                onClick={() => setTableFilter("needs_review")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition flex items-center gap-1 ${
                  tableFilter === "needs_review"
                    ? "bg-trend-red text-background"
                    : validationSummary.needsReviewRows > 0
                    ? "bg-trend-red/10 text-trend-red border border-trend-red/30"
                    : "bg-nav-active text-muted-foreground"
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                <span>Needs Review ({validationSummary.needsReviewRows})</span>
              </button>
            </div>

            {validationSummary.needsReviewRows > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={excludeAllNeedsReview}
                className="text-xs h-7 text-muted-foreground hover:text-trend-red"
              >
                <EyeOff className="h-3 w-3 mr-1" />
                Exclude All Unresolved Issues
              </Button>
            )}
          </div>

          {/* Needs Review Section Highlight */}
          {validationSummary.needsReviewRows > 0 && (
            <Card className="border-trend-red/40 bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-trend-red flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {validationSummary.needsReviewRows} Transaction(s) Require Your Review
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Fix typographical or calculation errors below using inline editing, or exclude the row.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {reviewableTxs
                  .filter((tx) => tx.status === "needs_review" && !tx.isExcluded)
                  .map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 bg-background border border-trend-red/30 rounded-lg space-y-2 text-xs"
                    >
                      {/* Issues */}
                      <div className="space-y-1">
                        {tx.issues.map((issue, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-1.5 text-trend-red bg-trend-red/10 px-2 py-1 rounded"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{issue.message}</span>
                          </div>
                        ))}
                      </div>

                      {/* Edit form vs Read display */}
                      {editingRowId === tx.id && editForm ? (
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-border">
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-0.5">Date</label>
                            <input
                              type="text"
                              value={editForm.date}
                              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                              className="w-full px-2 py-1 text-xs bg-card border border-border rounded font-mono"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[10px] text-muted-foreground block mb-0.5">Narration</label>
                            <input
                              type="text"
                              value={editForm.narration}
                              onChange={(e) => setEditForm({ ...editForm, narration: e.target.value })}
                              className="w-full px-2 py-1 text-xs bg-card border border-border rounded"
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
                                className="px-1 py-1 text-xs bg-card border border-border rounded uppercase text-[10px]"
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
                                className="w-full px-2 py-1 text-xs bg-card border border-border rounded font-mono"
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
                                className="w-full px-2 py-1 text-xs bg-card border border-border rounded font-mono"
                              />
                              <Button
                                size="sm"
                                onClick={saveEditRow}
                                className="h-7 w-7 p-0 shrink-0 bg-trend-green text-background hover:bg-trend-green/90"
                                title="Save"
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
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 gap-2">
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
                              Fix
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
              </CardContent>
            </Card>
          )}

          {/* Preview Table */}
          <Card className="border-border bg-card">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#121418] border-b border-border text-muted-foreground text-[11px] uppercase">
                  <tr>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Narration</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium text-right">Balance</th>
                    <th className="p-3 font-medium">HMAC txHash</th>
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gridline">
                  {filteredTxs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        No transactions found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTxs.map((tx) => (
                      <tr
                        key={tx.id}
                        className={`hover:bg-nav-active/30 transition ${
                          tx.isExcluded
                            ? "opacity-40 line-through"
                            : tx.status === "needs_review"
                            ? "bg-trend-red/5"
                            : tx.isDuplicate
                            ? "opacity-60"
                            : ""
                        }`}
                      >
                        {/* Status */}
                        <td className="p-3 whitespace-nowrap">
                          {tx.isExcluded ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground font-mono text-[10px]">
                              <XCircle className="h-3 w-3" /> EXCLUDED
                            </span>
                          ) : tx.status === "needs_review" ? (
                            <span className="inline-flex items-center gap-1 text-trend-red font-mono text-[10px]">
                              <AlertTriangle className="h-3 w-3" /> REVIEW
                            </span>
                          ) : tx.isDuplicate ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground font-mono text-[10px]">
                              <CheckCircle2 className="h-3 w-3 text-muted-foreground" /> DUPLICATE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-trend-green font-mono text-[10px]">
                              <CheckCircle2 className="h-3 w-3 text-trend-green" /> NEW
                            </span>
                          )}
                        </td>

                        <td className="p-3 font-mono whitespace-nowrap">{tx.date}</td>
                        <td className="p-3 max-w-xs truncate text-foreground/90" title={tx.narration}>
                          {tx.narration}
                        </td>
                        <td className="p-3 uppercase font-mono text-[10px]">
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
                        <td className="p-3 text-right font-mono font-medium">
                          ₹{tx.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right font-mono text-muted-foreground">
                          ₹{tx.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 font-mono text-[10px] text-muted-foreground">
                          <span title={tx.txHash}>
                            {tx.txHash.substring(0, 10)}...{tx.txHash.substring(tx.txHash.length - 6)}
                          </span>
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
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
                              title={tx.isExcluded ? "Include" : "Exclude"}
                            >
                              {tx.isExcluded ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
