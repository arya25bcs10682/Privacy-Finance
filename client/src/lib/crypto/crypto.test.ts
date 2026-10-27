import { describe, it, expect } from "vitest";
import {
  deriveKeyFromSecret,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  encryptJSON,
  decryptJSON,
  encryptBlob,
  decryptBlob,
  deriveHmacKey,
  hmacTxHash,
  generateRecoveryCode,
  unwrapDataKeyFromRecoveryCode,
  base64ToArrayBuffer,
  type TxHashFields,
} from "./index";

describe("Web Crypto Library (window.crypto.subtle)", () => {
  const testSecret = "user-super-secure-login-passphrase-2026!";
  const testSalt = "privacy-finance-salt-test-constant";

  describe("1. Key Derivation & Wrapping Round Trip", () => {
    it("derives AES-KW wrapping key using PBKDF2-SHA256 (600,000 iterations) and wraps/unwraps data key", async () => {
      // 600,000 iterations per project specifications
      const wrappingKey = await deriveKeyFromSecret(testSecret, testSalt, 600_000, "AES-KW");
      expect(wrappingKey.algorithm.name).toBe("AES-KW");
      expect(wrappingKey.extractable).toBe(false);

      const originalDataKey = await generateDataKey();
      expect(originalDataKey.algorithm.name).toBe("AES-GCM");
      expect(originalDataKey.extractable).toBe(true);

      // Wrap
      const wrapped = await wrapDataKey(originalDataKey, wrappingKey);
      expect(typeof wrapped.ciphertext).toBe("string");
      expect(wrapped.ciphertext.length).toBeGreaterThan(0);

      // Unwrap
      const unwrappedKey = await unwrapDataKey(wrapped, wrappingKey);
      expect(unwrappedKey.algorithm.name).toBe("AES-GCM");

      // Verify unwrapped key functionality by cross-encrypting
      const secretPayload = { account: "HDFC-1234", balance: 500000 };
      const encrypted = await encryptJSON(secretPayload, unwrappedKey);
      const decrypted = await decryptJSON(encrypted, originalDataKey);
      expect(decrypted).toEqual(secretPayload);
    }, 15000);

    it("derives AES-GCM wrapping key and wraps/unwraps with fresh IV", async () => {
      const wrappingKey = await deriveKeyFromSecret(testSecret, testSalt, 10_000, "AES-GCM");
      expect(wrappingKey.algorithm.name).toBe("AES-GCM");
      expect(wrappingKey.extractable).toBe(false);

      const originalDataKey = await generateDataKey();
      const wrapped = await wrapDataKey(originalDataKey, wrappingKey);
      expect(wrapped.iv).toBeDefined();

      const unwrappedKey = await unwrapDataKey(wrapped, wrappingKey);
      const testMsg = { zeroKnowledge: true };
      const encrypted = await encryptJSON(testMsg, originalDataKey);
      const decrypted = await decryptJSON(encrypted, unwrappedKey);
      expect(decrypted).toEqual(testMsg);
    });
  });

  describe("2. JSON & Blob Encryption Round Trip", () => {
    it("round trips complex JSON payloads with emojis, nested objects, and numbers", async () => {
      const dataKey = await generateDataKey();
      const original = {
        bank: "HDFC",
        accountNumber: "50100492819234",
        transactions: [
          { date: "2026-01-15", amount: 12500.5, desc: "Salary Credit 💼", type: "CR" },
          { date: "2026-01-16", amount: 450.0, desc: "Grocery Store", type: "DR" },
        ],
        metadata: { encryptedAt: Date.now(), verified: true },
      };

      const encrypted = await encryptJSON(original, dataKey);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();

      // Ensure 12-byte IV (base64 of 12 bytes = 16 chars)
      const ivBytes = base64ToArrayBuffer(encrypted.iv);
      expect(ivBytes.byteLength).toBe(12);

      const decrypted = await decryptJSON(encrypted, dataKey);
      expect(decrypted).toEqual(original);
    });

    it("round trips binary files (Blob) correctly", async () => {
      const dataKey = await generateDataKey();
      const fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]); // %PDF-1.5 header
      const originalBlob = new Blob([fileBytes], { type: "application/pdf" });

      const encrypted = await encryptBlob(originalBlob, dataKey);
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext instanceof Blob).toBe(true);

      const decryptedBlob = await decryptBlob(encrypted, dataKey, { mimeType: "application/pdf" });
      const decryptedBuffer = await decryptedBlob.arrayBuffer();
      const decryptedBytes = new Uint8Array(decryptedBuffer);

      expect(decryptedBlob.type).toBe("application/pdf");
      expect(decryptedBytes).toEqual(fileBytes);
    });
  });

  describe("3. Recovery Code Round Trip", () => {
    it("generates a human-readable recovery code from dataKey and unwraps it correctly", async () => {
      const originalDataKey = await generateDataKey();
      const recoveryCode = await generateRecoveryCode(originalDataKey);

      // Verify format: RC-XXXX-XXXX-...
      expect(recoveryCode.startsWith("RC-")).toBe(true);
      const parts = recoveryCode.split("-");
      expect(parts.length).toBe(14); // "RC" + 13 groups of 4 chars = 14 parts

      // Unwrap using recovery code directly
      const recoveredKey = await unwrapDataKeyFromRecoveryCode(recoveryCode);
      expect(recoveredKey.algorithm.name).toBe("AES-GCM");

      // Verify functional equivalence
      const secret = { bank: "ICICI", note: "Zero Knowledge Secret" };
      const encrypted = await encryptJSON(secret, originalDataKey);
      const decrypted = await decryptJSON(encrypted, recoveredKey);
      expect(decrypted).toEqual(secret);
    });

    it("allows unwrapDataKey to accept the recovery code string directly", async () => {
      const originalDataKey = await generateDataKey();
      const recoveryCode = await generateRecoveryCode(originalDataKey);

      const unwrappedKey = await unwrapDataKey(recoveryCode);
      const data = { test: 12345 };
      const encrypted = await encryptJSON(data, originalDataKey);
      const decrypted = await decryptJSON(encrypted, unwrappedKey);
      expect(decrypted).toEqual(data);
    });

    it("generates standalone recovery code without arguments", async () => {
      const recoveryCode = await generateRecoveryCode();
      expect(recoveryCode.startsWith("RC-")).toBe(true);
      const key = await unwrapDataKeyFromRecoveryCode(recoveryCode);
      expect(key.algorithm.name).toBe("AES-GCM");
    });
  });

  describe("4. Wrong Key Fails", () => {
    it("fails to decrypt JSON when using an incorrect data key", async () => {
      const correctKey = await generateDataKey();
      const wrongKey = await generateDataKey();

      const encrypted = await encryptJSON({ confidential: "financial-report" }, correctKey);

      await expect(decryptJSON(encrypted, wrongKey)).rejects.toThrow();
    });

    it("fails to decrypt Blob when using an incorrect data key", async () => {
      const correctKey = await generateDataKey();
      const wrongKey = await generateDataKey();

      const blob = new Blob(["Sensitive statement content"], { type: "text/plain" });
      const encrypted = await encryptBlob(blob, correctKey);

      await expect(decryptBlob(encrypted, wrongKey)).rejects.toThrow();
    });

    it("fails to unwrap data key when using an incorrect wrapping key", async () => {
      const correctWrappingKey = await deriveKeyFromSecret("secret-pass-A", testSalt, 10_000);
      const wrongWrappingKey = await deriveKeyFromSecret("secret-pass-B", testSalt, 10_000);

      const dataKey = await generateDataKey();
      const wrapped = await wrapDataKey(dataKey, correctWrappingKey);

      await expect(unwrapDataKey(wrapped, wrongWrappingKey)).rejects.toThrow();
    });
  });

  describe("5. IV Uniqueness (Rule 5: Fresh random 12-byte IV per encryption)", () => {
    it("generates 100 unique 12-byte IVs for 100 consecutive encryptions of identical data", async () => {
      const dataKey = await generateDataKey();
      const payload = { test: "constant payload" };
      const ivSet = new Set<string>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const encrypted = await encryptJSON(payload, dataKey);
        const ivBytes = base64ToArrayBuffer(encrypted.iv);

        // Must be exactly 12 bytes
        expect(ivBytes.byteLength).toBe(12);
        ivSet.add(encrypted.iv);
      }

      // Every single IV must be distinct
      expect(ivSet.size).toBe(iterations);
    });
  });

  describe("6. Tamper Detection (Authentication Tag Verification)", () => {
    it("throws when ciphertext is modified by even a single bit", async () => {
      const dataKey = await generateDataKey();
      const encrypted = await encryptJSON({ balance: 999999 }, dataKey);

      const rawCiphertext = base64ToArrayBuffer(encrypted.ciphertext);
      // Flip the first byte
      rawCiphertext[0] ^= 0x01;

      // Re-encode tampered ciphertext
      let binary = "";
      for (let i = 0; i < rawCiphertext.byteLength; i++) {
        binary += String.fromCharCode(rawCiphertext[i]);
      }
      const tamperedCiphertext = btoa(binary);

      const tamperedEncrypted = {
        iv: encrypted.iv,
        ciphertext: tamperedCiphertext,
      };

      await expect(decryptJSON(tamperedEncrypted, dataKey)).rejects.toThrow();
    });

    it("throws when IV is modified", async () => {
      const dataKey = await generateDataKey();
      const encrypted = await encryptJSON({ secure: true }, dataKey);

      const rawIV = base64ToArrayBuffer(encrypted.iv);
      rawIV[0] ^= 0xff; // Corrupt IV

      let binary = "";
      for (let i = 0; i < rawIV.byteLength; i++) {
        binary += String.fromCharCode(rawIV[i]);
      }
      const tamperedIV = btoa(binary);

      const tamperedEncrypted = {
        iv: tamperedIV,
        ciphertext: encrypted.ciphertext,
      };

      await expect(decryptJSON(tamperedEncrypted, dataKey)).rejects.toThrow();
    });

    it("throws when encrypted blob ciphertext is altered", async () => {
      const dataKey = await generateDataKey();
      const originalBlob = new Blob(["Valid statement data"], { type: "text/plain" });
      const encrypted = await encryptBlob(originalBlob, dataKey);

      const buffer = await encrypted.ciphertext.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      bytes[bytes.length - 1] ^= 0x01; // Corrupt authentication tag at end

      const tamperedBlob = new Blob([bytes], { type: "application/octet-stream" });
      await expect(
        decryptBlob({ iv: encrypted.iv, ciphertext: tamperedBlob }, dataKey)
      ).rejects.toThrow();
    });
  });

  describe("7. HMAC Transaction Hash Determinism & HKDF Key Derivation", () => {
    const fields: TxHashFields = {
      date: "2026-02-01",
      amount: "4500.00",
      type: "Debit",
      cleanedDescription: "Swiggy Food Delivery",
      runningBalance: "142500.50",
    };

    it("produces deterministic 64-char hex hash for identical fields and key", async () => {
      const dataKey = await generateDataKey();
      const hmacKey = await deriveHmacKey(dataKey);

      const hash1 = await hmacTxHash(fields, hmacKey);
      const hash2 = await hmacTxHash(fields, hmacKey);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("automatically derives HMAC key if dataKey is passed directly to hmacTxHash", async () => {
      const dataKey = await generateDataKey();

      const hash1 = await hmacTxHash(fields, dataKey);
      const hash2 = await hmacTxHash(fields, dataKey);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces completely different hashes when any transaction field is modified", async () => {
      const dataKey = await generateDataKey();
      const baseHash = await hmacTxHash(fields, dataKey);

      // Mutate amount by 1 cent
      const hashDiffAmount = await hmacTxHash({ ...fields, amount: "4500.01" }, dataKey);
      expect(hashDiffAmount).not.toBe(baseHash);

      // Mutate date
      const hashDiffDate = await hmacTxHash({ ...fields, date: "2026-02-02" }, dataKey);
      expect(hashDiffDate).not.toBe(baseHash);

      // Mutate type
      const hashDiffType = await hmacTxHash({ ...fields, type: "Credit" }, dataKey);
      expect(hashDiffType).not.toBe(baseHash);

      // Mutate description
      const hashDiffDesc = await hmacTxHash(
        { ...fields, cleanedDescription: "Zomato Food Delivery" },
        dataKey
      );
      expect(hashDiffDesc).not.toBe(baseHash);

      // Mutate balance
      const hashDiffBalance = await hmacTxHash({ ...fields, runningBalance: "142500.51" }, dataKey);
      expect(hashDiffBalance).not.toBe(baseHash);
    });

    it("produces different hash when different data keys are used", async () => {
      const dataKey1 = await generateDataKey();
      const dataKey2 = await generateDataKey();

      const hash1 = await hmacTxHash(fields, dataKey1);
      const hash2 = await hmacTxHash(fields, dataKey2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
