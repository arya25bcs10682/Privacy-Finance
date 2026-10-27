import { describe, it, expect, vi, beforeEach } from "vitest";
import { redactPii } from "./redact";
import { processAndUploadStatement, extractStatementPages } from "./extractor";
import { generateDataKey } from "../crypto";
import * as api from "../api";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn().mockImplementation((params: { password?: string }) => {
    if (params.password === "WRONG") {
      const err = new Error("PasswordException: Incorrect password");
      err.name = "PasswordException";
      return { promise: Promise.reject(err) };
    }
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({
            items: [
              { str: "HDFC Bank Statement" },
              { str: "Account No: 50100492819234" },
              { str: "Customer Name: ARYA SHARMA" },
              { str: "15/01/2026" },
              { str: "UPI-SWIGGY-BANGALORE" },
              { str: "450.00 DR" },
              { str: "50000.00" },
            ],
          }),
        }),
      }),
    };
  }),
}));

describe("Client-Side PII Redaction & PDF Extraction Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Regex-Based PII Redaction", () => {
    it("redacts bank account numbers, customer IDs, and PAN cards", () => {
      const sampleText = `
        HDFC BANK STATEMENT
        Account No: 50100492819234
        Cust ID: 89201948
        PAN: ABCDE1234F
        15/01/2026 UPI/50123/Swiggy 450.00 DR 125000.00
      `;

      const { redactedText, redactedCount } = redactPii(sampleText);

      expect(redactedText).toContain("[ACCOUNT_NUMBER_REDACTED]");
      expect(redactedText).not.toContain("50100492819234");
      expect(redactedText).toContain("[CUSTOMER_ID_REDACTED]");
      expect(redactedText).not.toContain("89201948");
      expect(redactedText).toContain("[PAN_REDACTED]");
      expect(redactedText).not.toContain("ABCDE1234F");

      // Verify transaction details remain intact
      expect(redactedText).toContain("15/01/2026");
      expect(redactedText).toContain("UPI/50123/Swiggy");
      expect(redactedText).toContain("450.00");
      expect(redactedCount).toBeGreaterThanOrEqual(3);
    });

    it("redacts customer names and address details", () => {
      const sampleText = `
        Account Holder Name: ARYA SHARMA
        Address: Flat 402, Royal Palms, Indiranagar, Bangalore 560038
        Phone: +91 9876543210
        Email: user.secret@gmail.com
        16/01/2026 SALARY CREDIT ACME 85000.00 CR 210000.00
      `;

      const { redactedText } = redactPii(sampleText);

      expect(redactedText).toContain("[NAME_REDACTED]");
      expect(redactedText).not.toContain("ARYA SHARMA");
      expect(redactedText).toContain("[ADDRESS_REDACTED]");
      expect(redactedText).toContain("[PINCODE_REDACTED]");
      expect(redactedText).not.toContain("560038");
      expect(redactedText).toContain("[PHONE_REDACTED]");
      expect(redactedText).not.toContain("9876543210");
      expect(redactedText).toContain("[EMAIL_REDACTED]");
      expect(redactedText).not.toContain("user.secret@gmail.com");

      // Transaction row is preserved
      expect(redactedText).toContain("SALARY CREDIT ACME");
      expect(redactedText).toContain("85000.00");
    });
  });

  describe("2. PDF Extraction & Password Protection", () => {
    it("extracts and redacts pages using pdfjs-dist", async () => {
      const mockPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const pages = await extractStatementPages(mockPdfBytes);

      expect(pages).toHaveLength(1);
      expect(pages[0].pageNumber).toBe(1);
      // PII stripped in redactedText
      expect(pages[0].redacted.redactedText).toContain("[ACCOUNT_NUMBER_REDACTED]");
      expect(pages[0].redacted.redactedText).toContain("[NAME_REDACTED]");
      expect(pages[0].redacted.redactedText).not.toContain("50100492819234");
      expect(pages[0].redacted.redactedText).not.toContain("ARYA SHARMA");
    });

    it("throws PdfPasswordRequiredError when PDF is protected with wrong or missing password", async () => {
      const mockPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      await expect(extractStatementPages(mockPdfBytes, "WRONG")).rejects.toThrow(
        "Password required"
      );
    });
  });

  describe("3. Client-Side End-to-End Pipeline", () => {
    it("extracts, redacts, calls /api/parse, encrypts with dataKey, and sends to /transactions/bulk", async () => {
      const dataKey = await generateDataKey();

      // Mock API calls
      const apiSpy = vi.spyOn(api, "apiFetch").mockImplementation(async (endpoint, options) => {
        if (endpoint === "/parse") {
          const body = JSON.parse(options?.body as string);
          // Verify that ONLY redacted text is sent to server
          expect(body.text).toContain("[ACCOUNT_NUMBER_REDACTED]");
          expect(body.text).toContain("[NAME_REDACTED]");
          expect(body.text).not.toContain("50100492819234");
          expect(body.text).not.toContain("ARYA SHARMA");

          return {
            transactions: [
              {
                date: "2026-01-15",
                narration: "Swiggy Food",
                type: "debit",
                amount: 450,
                balance: 50000,
              },
            ],
            count: 1,
          };
        }

        if (endpoint === "/transactions/bulk") {
          const body = JSON.parse(options?.body as string);
          expect(body.transactions).toHaveLength(1);

          // Verify payload is encrypted (AES-GCM ciphertext)
          expect(body.transactions[0].encryptedPayload).toHaveProperty("iv");
          expect(body.transactions[0].encryptedPayload).toHaveProperty("ct");
          expect(body.transactions[0]).toHaveProperty("txHash");
          expect(body.transactions[0].month).toBe("2026-01");

          return {
            insertedCount: 1,
            skippedCount: 0,
            total: 1,
          };
        }

        return {};
      });

      const mockPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const result = await processAndUploadStatement(mockPdfBytes, dataKey);

      expect(apiSpy).toHaveBeenCalledWith("/parse", expect.any(Object));
      expect(apiSpy).toHaveBeenCalledWith("/transactions/bulk", expect.any(Object));
      expect(result.totalExtracted).toBe(1);
      expect(result.insertedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
    });
  });
});
