import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvestmentsPage } from "./InvestmentsPage";
import { KeyContext } from "@/context/KeyContext";
import { TransactionContext } from "@/context/TransactionContext";
import type { EnrichedHolding } from "@/lib/holdings/types";

// Helper mock context factory
function renderInvestmentsPage(contextOverrides: Record<string, unknown> = {}, isUnlocked = true) {
  const dummyKey = {} as CryptoKey;

  const defaultTxContext = {
    transactions: [],
    selectedMonth: "2026-02",
    setSelectedMonth: vi.fn(),
    availableMonths: ["2026-02"],
    rules: [],
    overrides: {},
    recurringExpenses: [],
    budgets: {},
    categoryBudgetMetrics: [],
    budgetAlerts: [],
    bills: [],
    billReminders: [],
    pushPermission: "default" as NotificationPermission,
    isLoading: false,
    error: null,
    refreshTransactions: vi.fn(),
    addRule: vi.fn(),
    removeRule: vi.fn(),
    setOverride: vi.fn(),
    clearOverride: vi.fn(),
    setBudgetLimit: vi.fn(),
    updateBudgetLimits: vi.fn(),
    saveBill: vi.fn(),
    deleteBill: vi.fn(),
    markBillAsPaid: vi.fn(),
    requestPushPermission: vi.fn(),
    holdings: [],
    quotes: {},
    enrichedHoldings: [] as EnrichedHolding[],
    portfolioSummary: {
      totalValue: 0,
      totalInvested: 0,
      totalPnlAmount: 0,
      totalPnlPercent: 0,
      dayChangeAmount: 0,
      dayChangePercent: 0,
      holdingsCount: 0,
      stocksCount: 0,
      mfCount: 0,
    },
    portfolioAllocation: [],
    isQuotesLoading: false,
    saveHolding: vi.fn().mockResolvedValue({ id: "h1" }),
    deleteHolding: vi.fn().mockResolvedValue(undefined),
    refreshQuotes: vi.fn(),
    ...contextOverrides,
  };

  const keyContextValue = {
    dataKey: isUnlocked ? dummyKey : null,
    salt: "dummy-salt",
    isUnlocked,
    isMasterKeySet: true,
    unlockVault: vi.fn(),
    lockVault: vi.fn(),
    setupMasterPassword: vi.fn(),
    resetVault: vi.fn(),
    logoutAndPurge: vi.fn(),
  };

  return {
    ...render(
      <KeyContext.Provider value={keyContextValue as any}>
        <TransactionContext.Provider value={defaultTxContext as any}>
          <InvestmentsPage />
        </TransactionContext.Provider>
      </KeyContext.Provider>
    ),
    defaultTxContext,
  };
}

describe("InvestmentsPage Component", () => {
  it("renders empty state with 'Add your first holding' when portfolio has no holdings", () => {
    renderInvestmentsPage({ enrichedHoldings: [] });

    expect(screen.getAllByText(/Add your first holding/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Total Invested/i)).toBeInTheDocument();
    expect(screen.getByText(/Current Value/i)).toBeInTheDocument();
  });

  it("renders loading state when isLoading is true", () => {
    renderInvestmentsPage({ isLoading: true });

    expect(screen.getByText(/Loading investment holdings.../i)).toBeInTheDocument();
  });

  it("renders existing holdings with units, avg price, invested amount, current price, current value, and P/L", () => {
    const mockHoldings: EnrichedHolding[] = [
      {
        id: "hold-1",
        symbol: "RELIANCE.NS",
        name: "Reliance Industries",
        units: 10,
        avgPrice: 2500,
        investedValue: 25000,
        currentPrice: 2900,
        currentValue: 29000,
        totalPnlAmount: 4000,
        totalPnlPercent: 16.0,
        dayChangeAmount: 200,
        dayChangePercent: 0.69,
        assetType: "stock",
        currency: "INR",
        hasLiveQuote: true,
        purchaseDate: "2023-01-15",
      },
      {
        id: "hold-2",
        symbol: "TCS.NS",
        name: "Tata Consultancy Services",
        units: 5,
        avgPrice: 3800,
        investedValue: 19000,
        currentPrice: 3500,
        currentValue: 17500,
        totalPnlAmount: -1500,
        totalPnlPercent: -7.89,
        dayChangeAmount: -50,
        dayChangePercent: -0.28,
        assetType: "stock",
        currency: "INR",
        hasLiveQuote: true,
      },
    ];

    renderInvestmentsPage({
      enrichedHoldings: mockHoldings,
      holdings: mockHoldings,
      portfolioSummary: {
        totalValue: 46500,
        totalInvested: 44000,
        totalPnlAmount: 2500,
        totalPnlPercent: 5.68,
        dayChangeAmount: 150,
        dayChangePercent: 0.32,
        holdingsCount: 2,
        stocksCount: 2,
        mfCount: 0,
      },
    });

    // Asset & Symbol names
    expect(screen.getByText("Reliance Industries")).toBeInTheDocument();
    expect(screen.getByText("RELIANCE.NS")).toBeInTheDocument();
    expect(screen.getByText(/Bought 2023-01-15/i)).toBeInTheDocument();

    expect(screen.getByText("Tata Consultancy Services")).toBeInTheDocument();
    expect(screen.getByText("TCS.NS")).toBeInTheDocument();

    // Portfolio stat cards
    expect(screen.getByText("₹44,000")).toBeInTheDocument(); // Total invested
    expect(screen.getByText("₹46,500")).toBeInTheDocument(); // Current value
  });

  it("handles quote fetch failure by displaying 'price unavailable' without crashing", () => {
    const unquotedHolding: EnrichedHolding[] = [
      {
        id: "hold-unquoted",
        symbol: "UNLISTED.NS",
        name: "Unlisted Startup",
        units: 100,
        avgPrice: 50,
        investedValue: 5000,
        currentPrice: 50,
        currentValue: 5000,
        totalPnlAmount: 0,
        totalPnlPercent: 0,
        dayChangeAmount: 0,
        dayChangePercent: 0,
        assetType: "stock",
        currency: "INR",
        hasLiveQuote: false,
        quoteUnavailable: true,
      },
    ];

    renderInvestmentsPage({
      enrichedHoldings: unquotedHolding,
      holdings: unquotedHolding,
    });

    expect(screen.getByText("Unlisted Startup")).toBeInTheDocument();
    // Verify "price unavailable" badge/label is displayed
    expect(screen.getAllByText(/price unavailable/i).length).toBeGreaterThan(0);
  });

  it("validates form inputs: rejects units <= 0 and price < 0", async () => {
    renderInvestmentsPage({ enrichedHoldings: [] });

    // Open Add Holding modal
    const addBtn = screen.getByRole("button", { name: /Add Holding/i });
    fireEvent.click(addBtn);

    expect(screen.getByText("Add Investment Holding")).toBeInTheDocument();

    // Fill invalid symbol
    const symbolInput = screen.getByPlaceholderText(/e\.g\. RELIANCE\.NS/i);
    fireEvent.change(symbolInput, { target: { value: "INVALID SYMBOL @@!" } });

    const unitsInput = screen.getByPlaceholderText(/e\.g\. 50/i);
    fireEvent.change(unitsInput, { target: { value: "-5" } });

    const priceInput = screen.getByPlaceholderText(/e\.g\. 2450\.00/i);
    fireEvent.change(priceInput, { target: { value: "100" } });

    const saveBtn = screen.getByRole("button", { name: /Save Holding/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invalid symbol/i)).toBeInTheDocument();
    });

    // Fix symbol to valid but keep units <= 0
    fireEvent.change(symbolInput, { target: { value: "INFY.NS" } });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Units must be greater than 0/i)).toBeInTheDocument();
    });

    // Set units > 0 but price < 0
    fireEvent.change(unitsInput, { target: { value: "10" } });
    fireEvent.change(priceInput, { target: { value: "-50" } });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Average buy price must be greater than or equal to 0/i)).toBeInTheDocument();
    });
  });

  it("allows opening edit modal with pre-populated values and updating holding", async () => {
    const mockHolding: EnrichedHolding = {
      id: "edit-test-1",
      symbol: "HDFCBANK.NS",
      name: "HDFC Bank Ltd",
      units: 20,
      avgPrice: 1550,
      investedValue: 31000,
      currentPrice: 1650,
      currentValue: 33000,
      totalPnlAmount: 2000,
      totalPnlPercent: 6.45,
      dayChangeAmount: 100,
      dayChangePercent: 0.3,
      assetType: "stock",
      currency: "INR",
      hasLiveQuote: true,
      purchaseDate: "2022-06-10",
    };

    const saveHoldingMock = vi.fn().mockResolvedValue(mockHolding);

    renderInvestmentsPage({
      enrichedHoldings: [mockHolding],
      holdings: [mockHolding],
      saveHolding: saveHoldingMock,
    });

    // Click Edit button
    const editBtn = screen.getByTitle("Edit Holding");
    fireEvent.click(editBtn);

    expect(screen.getByText("Edit Investment Holding")).toBeInTheDocument();
    const unitsInput = screen.getByDisplayValue("20");
    expect(unitsInput).toBeInTheDocument();

    // Modify units to 25 and submit
    fireEvent.change(unitsInput, { target: { value: "25" } });
    const updateBtn = screen.getByRole("button", { name: /Update Holding/i });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(saveHoldingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "edit-test-1",
          symbol: "HDFCBANK.NS",
          units: 25,
          avgPrice: 1550,
        })
      );
    });
  });
});
