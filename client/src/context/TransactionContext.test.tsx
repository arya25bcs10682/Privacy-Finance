import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { KeyContext, type KeyContextType } from "./KeyContext";
import { TransactionProvider, useTransactionContext } from "./TransactionContext";
import { generateDataKey, encryptJSON } from "@/lib/crypto";
import * as api from "@/lib/api";

describe("TransactionContext (In-Memory Client-Side Decrypted Store)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockKeyContext = (overrides: Partial<KeyContextType> = {}): KeyContextType => ({
    user: { id: "user-1", email: "alice@example.com" },
    dataKey: null,
    keySalt: "salt-test",
    wrappedDataKey: null,
    wrappedDataKeyByRecovery: null,
    isAuthenticated: true,
    isLocked: false,
    isLoading: false,
    idleTimeoutRemainingMs: 900000,
    login: vi.fn(),
    prepareSignup: vi.fn(),
    completeSignup: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecovery: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    resetIdleTimer: vi.fn(),
    ...overrides,
  });

  const createWrapper = (keyContextValue: KeyContextType) => {
    return ({ children }: { children: React.ReactNode }) => (
      <KeyContext.Provider value={keyContextValue}>
        <TransactionProvider>{children}</TransactionProvider>
      </KeyContext.Provider>
    );
  };

  it("fetches and decrypts transactions in memory when vault is unlocked", async () => {
    const dataKey = await generateDataKey();

    const sampleTx1 = {
      date: "2026-03-01",
      narration: "SALARY CREDIT TECH CORP",
      type: "credit" as const,
      amount: 100000,
      balance: 100000,
    };

    const sampleTx2 = {
      date: "2026-03-05",
      narration: "SWIGGY BANGALORE IN",
      type: "debit" as const,
      amount: 540,
      balance: 99460,
    };

    const enc1 = await encryptJSON(sampleTx1, dataKey);
    const enc2 = await encryptJSON(sampleTx2, dataKey);

    const mockDocs = [
      {
        _id: "tx-doc-1",
        txHash: "hash-1",
        month: "2026-03",
        encryptedPayload: { iv: enc1.iv, ct: enc1.ciphertext },
      },
      {
        _id: "tx-doc-2",
        txHash: "hash-2",
        month: "2026-03",
        encryptedPayload: { iv: enc2.iv, ct: enc2.ciphertext },
      },
    ];

    vi.spyOn(api, "apiFetch").mockResolvedValue({ transactions: mockDocs });

    const keyContextValue = createMockKeyContext({
      dataKey,
      isLocked: false,
    });

    const wrapper = createWrapper(keyContextValue);
    const { result } = renderHook(() => useTransactionContext(), { wrapper });

    await act(async () => {
      await result.current.refreshTransactions();
    });

    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.transactions[0].narration).toBe("SALARY CREDIT TECH CORP");
    expect(result.current.transactions[0].category).toBe("Income & Salary");
    expect(result.current.transactions[0].balance).toBe(100000);

    expect(result.current.transactions[1].narration).toBe("SWIGGY BANGALORE IN");
    expect(result.current.transactions[1].category).toBe("Food & Dining");
    expect(result.current.transactions[1].balance).toBe(99460);

    expect(result.current.availableMonths).toContain("2026-03");
  });

  it("wipes decrypted transactions from memory when vault is locked", async () => {
    const dataKey = await generateDataKey();
    const enc = await encryptJSON(
      { date: "2026-02-10", narration: "Rent", type: "debit", amount: 25000, balance: 50000 },
      dataKey
    );

    vi.spyOn(api, "apiFetch").mockResolvedValue({
      transactions: [
        {
          _id: "doc-1",
          txHash: "h1",
          month: "2026-02",
          encryptedPayload: { iv: enc.iv, ct: enc.ciphertext },
        },
      ],
    });

    let isLocked = false;
    let currentKey: CryptoKey | null = dataKey;

    const getKeyContextValue = () =>
      createMockKeyContext({
        dataKey: currentKey,
        isLocked,
      });

    const { result, rerender } = renderHook(() => useTransactionContext(), {
      wrapper: ({ children }) => (
        <KeyContext.Provider value={getKeyContextValue()}>
          <TransactionProvider>{children}</TransactionProvider>
        </KeyContext.Provider>
      ),
    });

    await act(async () => {
      await result.current.refreshTransactions();
    });

    expect(result.current.transactions).toHaveLength(1);

    // Simulate locking the vault
    isLocked = true;
    currentKey = null;

    rerender();

    // Zero-knowledge assertion: store in memory must be empty
    expect(result.current.transactions).toEqual([]);
    expect(result.current.availableMonths).toEqual([]);
  });

  it("handles corrupted or tampered transaction documents gracefully by skipping them", async () => {
    const dataKey = await generateDataKey();
    const validEnc = await encryptJSON(
      { date: "2026-01-01", narration: "Grocery Store", type: "debit", amount: 1200, balance: 48000 },
      dataKey
    );

    const mockDocs = [
      {
        _id: "valid-doc",
        txHash: "valid-hash",
        month: "2026-01",
        encryptedPayload: { iv: validEnc.iv, ct: validEnc.ciphertext },
      },
      {
        _id: "tampered-doc",
        txHash: "tampered-hash",
        month: "2026-01",
        encryptedPayload: { iv: "corrupted-iv", ct: "corrupted-ct" },
      },
    ];

    vi.spyOn(api, "apiFetch").mockResolvedValue({ transactions: mockDocs });

    const keyContextValue = createMockKeyContext({
      dataKey,
      isLocked: false,
    });

    const wrapper = createWrapper(keyContextValue);
    const { result } = renderHook(() => useTransactionContext(), { wrapper });

    await act(async () => {
      await result.current.refreshTransactions();
    });

    // Valid doc should decrypt successfully, tampered doc skipped with warn
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.transactions[0].id).toBe("valid-doc");
  });

  it("allows setting and switching selected month", async () => {
    const keyContextValue = createMockKeyContext({
      dataKey: null,
      isLocked: false,
    });

    const wrapper = createWrapper(keyContextValue);
    const { result } = renderHook(() => useTransactionContext(), { wrapper });

    act(() => {
      result.current.setSelectedMonth("2026-04");
    });

    expect(result.current.selectedMonth).toBe("2026-04");
  });

  it("applies manual override and detects recurring transactions from in-memory records", async () => {
    const dataKey = await generateDataKey();

    const tx1 = {
      date: "2026-01-15",
      narration: "ACH D- CITIBANK -NETFLIX ENT-12345",
      type: "debit" as const,
      amount: 649,
      balance: 50000,
    };
    const tx2 = {
      date: "2026-02-14",
      narration: "ACH D- CITIBANK -NETFLIX ENT-12345",
      type: "debit" as const,
      amount: 649,
      balance: 49351,
    };

    const enc1 = await encryptJSON(tx1, dataKey);
    const enc2 = await encryptJSON(tx2, dataKey);

    const mockDocs = [
      {
        _id: "doc-1",
        txHash: "hash-netflix-1",
        month: "2026-01",
        encryptedPayload: { iv: enc1.iv, ct: enc1.ciphertext },
      },
      {
        _id: "doc-2",
        txHash: "hash-netflix-2",
        month: "2026-02",
        encryptedPayload: { iv: enc2.iv, ct: enc2.ciphertext },
      },
    ];

    vi.spyOn(api, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/transactions") return { transactions: mockDocs };
      if (endpoint === "/auth/rules") return { encryptedRules: null };
      return {};
    });

    const keyContextValue = createMockKeyContext({
      dataKey,
      isLocked: false,
    });

    const wrapper = createWrapper(keyContextValue);
    const { result } = renderHook(() => useTransactionContext(), { wrapper });

    await act(async () => {
      await result.current.refreshTransactions();
    });

    // Both should be in memory
    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.transactions[0].category).toBe("Entertainment");

    // Recurring expense detected: 30 days interval
    expect(result.current.recurringExpenses).toHaveLength(1);
    expect(result.current.recurringExpenses[0].merchant).toBe("Netflix Ent");
    expect(result.current.recurringExpenses[0].amount).toBe(649);
    expect(result.current.recurringExpenses[0].nextExpectedDate).toBe("2026-03-16");

    // Apply manual override on first transaction
    await act(async () => {
      await result.current.setOverride("hash-netflix-1", "Utilities & Bills");
    });

    expect(result.current.transactions[0].category).toBe("Utilities & Bills");
  });
});
