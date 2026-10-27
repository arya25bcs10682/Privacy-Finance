import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useKeyContext } from "./KeyContext";
import { apiFetch } from "@/lib/api";
import { decryptJSON } from "@/lib/crypto";
import {
  categorizeTransactionWithRules,
  detectRecurringTransactions,
  type CategorizationRule,
  type RecurringExpense,
} from "@/lib/transactions/categorizer";
import {
  loadRulesAndOverrides,
  addOrUpdateRule as storageAddRule,
  removeRule as storageRemoveRule,
  setTransactionOverride as storageSetOverride,
  clearTransactionOverride as storageClearOverride,
} from "@/lib/storage/rulesStorage";
import {
  loadBudgetForMonth,
  saveBudgetForMonth,
  DEFAULT_CATEGORY_LIMITS,
  type BudgetPeriod,
} from "@/lib/storage/budgetStorage";
import {
  calculateCategoryBudgets,
  getBudgetAlerts,
  type CategoryBudgetMetric,
  type BudgetAlert,
} from "@/lib/transactions/budgets";
import type { BillItem, BillReminder } from "@/lib/bills/types";
import { computeBillReminders } from "@/lib/bills/reminders";
import {
  loadEncryptedBills,
  saveEncryptedBill,
  deleteEncryptedBill,
  mergeBills,
} from "@/lib/storage/billStorage";
import {
  checkNotificationSupport,
  requestNotificationPermission as requestPushPerm,
  sendLocalBillNotification,
} from "@/lib/notifications/pushNotifications";
import type {
  HoldingItem,
  QuoteData,
  EnrichedHolding,
  PortfolioSummary,
  AssetAllocationItem,
} from "@/lib/holdings/types";
import {
  loadEncryptedHoldings,
  saveEncryptedHolding,
  deleteEncryptedHolding,
} from "@/lib/storage/holdingStorage";
import { purgeAllEncryptedStorage } from "@/lib/storage/purge";
import {
  fetchAllHoldingsQuotes,
  computePortfolio,
} from "@/lib/holdings/marketData";

export interface DecryptedTransaction {
  id: string;
  txHash: string;
  month: string;
  accountId?: string;
  date: string;
  narration: string;
  merchant: string;
  type: "debit" | "credit";
  amount: number;
  balance: number;
  category: string;
}

interface EncryptedTransactionDoc {
  _id: string;
  txHash: string;
  month: string;
  accountId?: string;
  encryptedPayload: {
    iv: string;
    ct?: string;
    ciphertext?: string;
  };
}

interface TransactionContextType {
  transactions: DecryptedTransaction[];
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  availableMonths: string[];
  rules: CategorizationRule[];
  overrides: Record<string, string>;
  recurringExpenses: RecurringExpense[];
  budgets: Record<string, number>;
  budgetPeriods: Record<string, BudgetPeriod>;
  categoryBudgetMetrics: CategoryBudgetMetric[];
  budgetAlerts: BudgetAlert[];
  bills: BillItem[];
  billReminders: BillReminder[];
  pushPermission: NotificationPermission;
  isLoading: boolean;
  error: string | null;
  refreshTransactions: () => Promise<void>;
  addRule: (rule: Omit<CategorizationRule, "id">) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  setOverride: (txHash: string, category: string) => Promise<void>;
  clearOverride: (txHash: string) => Promise<void>;
  setBudgetLimit: (category: string, limit: number, period?: BudgetPeriod) => Promise<void>;
  updateBudgetLimits: (limits: Record<string, number>, periods?: Record<string, BudgetPeriod>) => Promise<void>;
  saveBill: (bill: Omit<BillItem, "id"> & { id?: string }) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  markBillAsPaid: (id: string, isPaid?: boolean) => Promise<void>;
  requestPushPermission: () => Promise<NotificationPermission>;
  holdings: HoldingItem[];
  quotes: Record<string, QuoteData>;
  enrichedHoldings: EnrichedHolding[];
  portfolioSummary: PortfolioSummary;
  portfolioAllocation: AssetAllocationItem[];
  portfolioCurrency: string;
  setPortfolioCurrency: (currency: string) => void;
  isQuotesLoading: boolean;
  saveHolding: (holding: Omit<HoldingItem, "id"> & { id?: string }) => Promise<HoldingItem>;
  deleteHolding: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
}

export const TransactionContext = createContext<TransactionContextType | null>(null);

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const { user, dataKey, isLocked } = useKeyContext();

  // In-memory decrypted cache (strictly wiped on lock/logout)
  const [transactions, setTransactions] = useState<DecryptedTransaction[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [budgets, setBudgets] = useState<Record<string, number>>({ ...DEFAULT_CATEGORY_LIMITS });
  const [budgetPeriods, setBudgetPeriods] = useState<Record<string, BudgetPeriod>>({});
  const [budgetId, setBudgetId] = useState<string | undefined>();
  const [savedBills, setSavedBills] = useState<BillItem[]>([]);
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [isQuotesLoading, setIsQuotesLoading] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() => {
    return checkNotificationSupport().permission;
  });

  const userSelectedMonthRef = useRef<boolean>(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetSelectedMonth = useCallback((m: string) => {
    userSelectedMonthRef.current = true;
    setSelectedMonth(m);
  }, []);

  // Wipes in-memory decrypted store if vault locks or user logs out (Zero-Knowledge Rule 2)
  useEffect(() => {
    if (!user || isLocked || !dataKey) {
      setTransactions([]);
      setRules([]);
      setOverrides({});
      setBudgets({ ...DEFAULT_CATEGORY_LIMITS });
      setBudgetPeriods({});
      setBudgetId(undefined);
      setSavedBills([]);
      setHoldings([]);
      setQuotes({});
      purgeAllEncryptedStorage();
      setAvailableMonths([]);
      setError(null);
    }
  }, [user, isLocked, dataKey]);

  // Load encrypted budget for selected month
  useEffect(() => {
    if (!user || isLocked || !dataKey) return;

    let isMounted = true;
    loadBudgetForMonth(selectedMonth, dataKey).then((doc) => {
      if (isMounted) {
        setBudgets(doc.limits);
        setBudgetPeriods(doc.periods || {});
        setBudgetId(doc.id);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [user, isLocked, dataKey, selectedMonth]);

  // Load encrypted bills
  useEffect(() => {
    if (!user || isLocked || !dataKey) return;

    let isMounted = true;
    loadEncryptedBills(dataKey).then((loaded) => {
      if (isMounted) {
        setSavedBills(loaded);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [user, isLocked, dataKey]);

  const refreshTransactions = useCallback(async () => {
    if (!user || isLocked || !dataKey) {
      setTransactions([]);
      setRules([]);
      setOverrides({});
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Load user rules and overrides in memory
      const userSettings = await loadRulesAndOverrides(dataKey);
      setRules(userSettings.rules || []);
      setOverrides(userSettings.overrides || {});

      // 2. Fetch encrypted transaction docs
      const res = await apiFetch<{ transactions: EncryptedTransactionDoc[] }>("/transactions");
      const encryptedDocs = res.transactions || [];

      // 3. Decrypt each transaction in browser memory using master dataKey
      const decryptedList = await Promise.all(
        encryptedDocs.map(async (doc) => {
          try {
            const rawPayload = await decryptJSON<{
              date: string;
              narration: string;
              type: "debit" | "credit";
              amount: number;
              balance: number;
              category?: string;
            }>(
              {
                iv: doc.encryptedPayload.iv,
                ciphertext: doc.encryptedPayload.ct || doc.encryptedPayload.ciphertext || "",
              },
              dataKey
            );

            // Apply 3-tier categorization: Manual Override -> User Rule -> Default Pattern
            const catResult = categorizeTransactionWithRules(
              rawPayload.narration,
              rawPayload.type,
              userSettings.rules,
              userSettings.overrides,
              doc.txHash
            );

            const category = userSettings.overrides[doc.txHash] || rawPayload.category || catResult.category;

            return {
              id: doc._id,
              txHash: doc.txHash,
              month: doc.month,
              accountId: doc.accountId,
              date: rawPayload.date,
              narration: rawPayload.narration,
              merchant: catResult.merchant,
              type: rawPayload.type,
              amount: rawPayload.amount,
              balance: rawPayload.balance,
              category,
            } as DecryptedTransaction;
          } catch (decErr) {
            console.warn(`Could not decrypt transaction ${doc._id}:`, decErr);
            return null;
          }
        })
      );

      const validDecrypted = decryptedList.filter((tx): tx is DecryptedTransaction => tx !== null);

      // Sort chronologically ascending
      validDecrypted.sort((a, b) => a.date.localeCompare(b.date));

      setTransactions(validDecrypted);

      // Compute distinct available months sorted descending (newest first)
      const monthsSet = new Set<string>();
      for (const tx of validDecrypted) {
        if (tx.month) monthsSet.add(tx.month);
      }
      const sortedMonths = Array.from(monthsSet).sort().reverse();
      setAvailableMonths(sortedMonths);

      // If selected month has no transactions and we have available months, default to latest
      if (sortedMonths.length > 0 && (!userSelectedMonthRef.current || !monthsSet.has(selectedMonth))) {
        setSelectedMonth(sortedMonths[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch transactions.");
    } finally {
      setIsLoading(false);
    }
  }, [user, isLocked, dataKey, selectedMonth]);

  // Initial fetch when vault is unlocked
  useEffect(() => {
    if (user && !isLocked && dataKey) {
      refreshTransactions();
    }
  }, [user, isLocked, dataKey, refreshTransactions]);

  // Recurring bills detection from in-memory decrypted transactions
  const recurringExpenses = useMemo(() => {
    return detectRecurringTransactions(transactions);
  }, [transactions]);

  // Merged bills: auto-detected recurring + saved/manual bills
  const bills = useMemo(() => {
    return mergeBills(recurringExpenses, savedBills);
  }, [recurringExpenses, savedBills]);

  // Client-side reminders computation
  const billReminders = useMemo(() => {
    return computeBillReminders(bills);
  }, [bills]);

  // Check and fire Web Push/local notifications for opted-in users
  useEffect(() => {
    if (pushPermission !== "granted" || billReminders.length === 0) return;

    const urgentReminders = billReminders.filter(
      (r) => r.status === "due_today" || r.status === "overdue"
    );

    if (urgentReminders.length > 0) {
      const top = urgentReminders[0];
      sendLocalBillNotification(
        top.status === "due_today" ? `Bill Due Today: ${top.name}` : `Bill Overdue: ${top.name}`,
        top.message
      );
    }
  }, [billReminders, pushPermission]);

  // Compute category budget metrics & alerts for the selected month
  const categoryBudgetMetrics = useMemo(() => {
    return calculateCategoryBudgets(transactions, budgets, budgetPeriods, selectedMonth);
  }, [transactions, budgets, budgetPeriods, selectedMonth]);

  const budgetAlerts = useMemo(() => {
    return getBudgetAlerts(categoryBudgetMetrics);
  }, [categoryBudgetMetrics]);

  // Actions for user-editable rules and manual overrides
  const addRule = useCallback(
    async (ruleData: Omit<CategorizationRule, "id">) => {
      if (!dataKey) return;
      const newRule: CategorizationRule = {
        ...ruleData,
        id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };
      const updated = await storageAddRule(newRule, dataKey);
      setRules(updated.rules);
      await refreshTransactions();
    },
    [dataKey, refreshTransactions]
  );

  const removeRule = useCallback(
    async (id: string) => {
      if (!dataKey) return;
      const updated = await storageRemoveRule(id, dataKey);
      setRules(updated.rules);
      await refreshTransactions();
    },
    [dataKey, refreshTransactions]
  );

  const setOverride = useCallback(
    async (txHash: string, category: string) => {
      if (!dataKey) return;
      const updated = await storageSetOverride(txHash, category, dataKey);
      setOverrides(updated.overrides);
      setTransactions((prev) =>
        prev.map((t) => (t.txHash === txHash ? { ...t, category } : t))
      );
    },
    [dataKey]
  );

  const clearOverride = useCallback(
    async (txHash: string) => {
      if (!dataKey) return;
      const updated = await storageClearOverride(txHash, dataKey);
      setOverrides(updated.overrides);
      await refreshTransactions();
    },
    [dataKey, refreshTransactions]
  );

  // Budget management actions
  const setBudgetLimit = useCallback(
    async (category: string, limit: number, period: BudgetPeriod = "monthly") => {
      if (!dataKey) return;
      const updatedLimits = { ...budgets, [category]: limit };
      const updatedPeriods = { ...budgetPeriods, [category]: period };
      setBudgets(updatedLimits);
      setBudgetPeriods(updatedPeriods);
      const newId = await saveBudgetForMonth(
        selectedMonth,
        updatedLimits,
        updatedPeriods,
        dataKey,
        budgetId
      );
      if (newId) setBudgetId(newId);
    },
    [dataKey, budgets, budgetPeriods, selectedMonth, budgetId]
  );

  const updateBudgetLimits = useCallback(
    async (newLimits: Record<string, number>, newPeriods?: Record<string, BudgetPeriod>) => {
      if (!dataKey) return;
      const updatedLimits = { ...budgets, ...newLimits };
      const updatedPeriods = { ...budgetPeriods, ...(newPeriods || {}) };
      setBudgets(updatedLimits);
      setBudgetPeriods(updatedPeriods);
      const newId = await saveBudgetForMonth(
        selectedMonth,
        updatedLimits,
        updatedPeriods,
        dataKey,
        budgetId
      );
      if (newId) setBudgetId(newId);
    },
    [dataKey, budgets, budgetPeriods, selectedMonth, budgetId]
  );

  // Bill actions
  const saveBill = useCallback(
    async (billData: Omit<BillItem, "id"> & { id?: string }) => {
      if (!dataKey) return;
      const saved = await saveEncryptedBill(billData, dataKey);
      setSavedBills((prev) => {
        const idx = prev.findIndex((b) => b.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
    },
    [dataKey]
  );

  const deleteBill = useCallback(
    async (id: string) => {
      await deleteEncryptedBill(id);
      setSavedBills((prev) => prev.filter((b) => b.id !== id));
    },
    []
  );

  const markBillAsPaid = useCallback(
    async (id: string, isPaid = true) => {
      if (!dataKey) return;

      const targetBill = bills.find((b) => b.id === id);
      if (!targetBill) return;

      const updatedBillData: Omit<BillItem, "id"> & { id?: string } = {
        ...targetBill,
        id: targetBill.id.startsWith("detected_") ? undefined : targetBill.id,
        isPaid,
        lastPaidDate: isPaid ? new Date().toISOString().split("T")[0] : undefined,
      };

      const saved = await saveEncryptedBill(updatedBillData, dataKey);
      setSavedBills((prev) => {
        const idx = prev.findIndex((b) => b.id === id || b.name.toLowerCase() === targetBill.name.toLowerCase());
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
    },
    [dataKey, bills]
  );

  const requestPushPermission = useCallback(async () => {
    const perm = await requestPushPerm();
    setPushPermission(perm);
    return perm;
  }, []);

  // 1. Load holdings on vault unlock
  useEffect(() => {
    if (!dataKey) {
      setHoldings([]);
      return;
    }
    let isMounted = true;
    loadEncryptedHoldings(dataKey)
      .then((loaded) => {
        if (isMounted) setHoldings(loaded);
      })
      .catch((err) => console.warn("Failed to load holdings:", err));

    return () => {
      isMounted = false;
    };
  }, [dataKey]);

  // 2. Fetch/refresh market data quotes for holdings
  const refreshQuotes = useCallback(async () => {
    if (holdings.length === 0) return;
    setIsQuotesLoading(true);
    try {
      const q = await fetchAllHoldingsQuotes(holdings);
      setQuotes((prev) => ({ ...prev, ...q }));
    } catch (err) {
      console.warn("Could not refresh quotes:", err);
    } finally {
      setIsQuotesLoading(false);
    }
  }, [holdings]);

  // Refresh quotes automatically when holdings are loaded/updated
  useEffect(() => {
    if (holdings.length > 0) {
      refreshQuotes();
    }
  }, [holdings.length, refreshQuotes]);

  // 3. Save holding (encrypted zero-knowledge)
  const saveHolding = useCallback(
    async (holdingData: Omit<HoldingItem, "id"> & { id?: string }) => {
      if (!dataKey) throw new Error("Vault is locked. Unlock vault to modify portfolio.");
      const saved = await saveEncryptedHolding(holdingData, dataKey);
      setHoldings((prev) => {
        const idx = prev.findIndex((h) => h.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
      return saved;
    },
    [dataKey]
  );

  // 4. Delete holding
  const deleteHolding = useCallback(async (id: string) => {
    await deleteEncryptedHolding(id);
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const [portfolioCurrency, setPortfolioCurrencyState] = useState<string>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem("pf_portfolio_currency") || "INR";
      }
    } catch {
      // Ignore localStorage errors
    }
    return "INR";
  });

  const setPortfolioCurrency = useCallback((currency: string) => {
    const upper = (currency || "INR").toUpperCase();
    setPortfolioCurrencyState(upper);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("pf_portfolio_currency", upper);
      }
    } catch {
      // Ignore
    }
  }, []);

  // 5. Compute portfolio metrics and allocation
  const { enriched: enrichedHoldings, summary: portfolioSummary, allocation: portfolioAllocation } =
    useMemo(() => {
      return computePortfolio(holdings, quotes, portfolioCurrency);
    }, [holdings, quotes, portfolioCurrency]);

  return (
    <TransactionContext.Provider
      value={{
        transactions,
        selectedMonth,
        setSelectedMonth: handleSetSelectedMonth,
        availableMonths,
        rules,
        overrides,
        recurringExpenses,
        budgets,
        budgetPeriods,
        categoryBudgetMetrics,
        budgetAlerts,
        bills,
        billReminders,
        pushPermission,
        isLoading,
        error,
        refreshTransactions,
        addRule,
        removeRule,
        setOverride,
        clearOverride,
        setBudgetLimit,
        updateBudgetLimits,
        saveBill,
        deleteBill,
        markBillAsPaid,
        requestPushPermission,
        holdings,
        quotes,
        enrichedHoldings,
        portfolioSummary,
        portfolioAllocation,
        portfolioCurrency,
        setPortfolioCurrency,
        isQuotesLoading,
        saveHolding,
        deleteHolding,
        refreshQuotes,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactionContext() {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("useTransactionContext must be used within a TransactionProvider");
  }
  return context;
}
