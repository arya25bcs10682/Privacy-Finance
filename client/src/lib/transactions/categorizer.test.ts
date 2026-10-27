import { describe, it, expect } from "vitest";
import {
  extractCleanMerchant,
  categorizeTransactionWithRules,
  detectRecurringTransactions,
  type CategorizationRule,
} from "./categorizer";

describe("Rule-Based Categorizer & Merchant Pattern Matching", () => {
  describe("Merchant Pattern Extraction on UPI/NEFT/ACH/IMPS narrations", () => {
    it("extracts clean merchant from UPI narrations across formats", () => {
      // UPI with reference numbers, VPA handles, remarks
      expect(
        extractCleanMerchant("UPI/402918239102/SWIGGY/paytm-123@paytm/Payment from Ph")
      ).toBe("Swiggy");

      expect(
        extractCleanMerchant("UPI-ZEPTO-zepto@axisbank-Ref 384920")
      ).toBe("Zepto");

      expect(
        extractCleanMerchant("UPI/DR/123456789012/ZOMATO/ICIC/zomato@icici/")
      ).toBe("Zomato");

      expect(
        extractCleanMerchant("UPI/P2M/982347293847/BLINKIT/INDUS/")
      ).toBe("Blinkit");

      expect(
        extractCleanMerchant("UPI/432109876543/STARBUCKS/starbucks@okhdfcbank/Coffee")
      ).toBe("Starbucks");
    });

    it("extracts clean merchant from NEFT narrations", () => {
      expect(
        extractCleanMerchant("NEFT CR-HDFC0000240-ACME CORP-SALARY FOR OCT")
      ).toBe("Acme Corp");

      expect(
        extractCleanMerchant("NEFT DR-UTIB0000123-LANDLORD RENT-TRANSFER")
      ).toBe("Landlord Rent");

      expect(
        extractCleanMerchant("NEFT-AXIS0000456-TATA POWER ELECTRICITY-BILL123")
      ).toBe("Tata Power Electricity");
    });

    it("extracts clean merchant from ACH / NACH narrations", () => {
      expect(
        extractCleanMerchant("ACH D- CITIBANK -NETFLIX ENT-12345678")
      ).toBe("Netflix Ent");

      expect(
        extractCleanMerchant("ACH DR-HDFC0001-NIPPON INDIA MF-SIP")
      ).toBe("Nippon India Mf");

      expect(
        extractCleanMerchant("NACH/HDFC0001/SPOTIFY INDIA/123456")
      ).toBe("Spotify India");
    });

    it("extracts clean merchant from IMPS narrations", () => {
      expect(
        extractCleanMerchant("IMPS/P2A/402918239102/AMAZON PAY/HDFC/")
      ).toBe("Amazon Pay");

      expect(
        extractCleanMerchant("IMPS-41238912-UBER INDIA-MUMBAI")
      ).toBe("Uber India");

      expect(
        extractCleanMerchant("IMPS/DR/5829103948/AIRTEL BROADBAND/ICICI")
      ).toBe("Airtel Broadband");
    });

    it("extracts clean merchant from POS / Card narrations", () => {
      expect(
        extractCleanMerchant("POS 402918239102 RELIANCE FRESH MUMBAI")
      ).toBe("Reliance Fresh");

      expect(
        extractCleanMerchant("E-COM SWIGGY BANGALORE IN")
      ).toBe("Swiggy");
    });

    it("handles edge cases and empty narrations gracefully", () => {
      expect(extractCleanMerchant("")).toBe("Unknown Merchant");
      expect(extractCleanMerchant("   ")).toBe("Unknown Merchant");
    });
  });

  describe("Rule-Based Categorization Hierarchy", () => {
    it("falls back to built-in merchant patterns by default", () => {
      const res1 = categorizeTransactionWithRules("UPI/123456/SWIGGY/swiggy@icici", "debit");
      expect(res1.category).toBe("Food & Dining");
      expect(res1.merchant).toBe("Swiggy");
      expect(res1.matchedBy).toBe("default");

      const res2 = categorizeTransactionWithRules("ACH D-NETFLIX-123", "debit");
      expect(res2.category).toBe("Entertainment");
      expect(res2.merchant).toBe("Netflix");

      const res3 = categorizeTransactionWithRules("NEFT CR-HDFC0001-TECH CORP SALARY", "credit");
      expect(res3.category).toBe("Income & Salary");
    });

    it("applies user-editable rules over defaults", () => {
      const userRules: CategorizationRule[] = [
        {
          id: "r1",
          pattern: "SWIGGY",
          category: "Entertainment", // User overrides default 'Food & Dining' to 'Entertainment'
          matchType: "contains",
        },
      ];

      const res = categorizeTransactionWithRules(
        "UPI/123456/SWIGGY/swiggy@icici",
        "debit",
        userRules
      );

      expect(res.category).toBe("Entertainment");
      expect(res.matchedBy).toBe("user_rule");
      expect(res.matchedRuleId).toBe("r1");
    });

    it("supports exact and regex match types in user rules", () => {
      const userRules: CategorizationRule[] = [
        {
          id: "r-regex",
          pattern: "uber.*pass",
          category: "Utilities & Bills",
          matchType: "regex",
        },
        {
          id: "r-exact",
          pattern: "Special Store",
          category: "Investments",
          matchType: "exact",
        },
      ];

      const resRegex = categorizeTransactionWithRules(
        "UBER RIDE PASS 2026",
        "debit",
        userRules
      );
      expect(resRegex.category).toBe("Utilities & Bills");
      expect(resRegex.matchedBy).toBe("user_rule");

      const resExact = categorizeTransactionWithRules(
        "Special Store",
        "debit",
        userRules
      );
      expect(resExact.category).toBe("Investments");
      expect(resExact.matchedBy).toBe("user_rule");
    });

    it("prioritizes manual override per transaction above all rules and defaults", () => {
      const userRules: CategorizationRule[] = [
        {
          id: "r1",
          pattern: "SWIGGY",
          category: "Food & Dining",
        },
      ];

      const overrides = {
        "tx-hash-special-lunch": "Travel & Commute", // Manual override for specific transaction
      };

      const res = categorizeTransactionWithRules(
        "UPI/123456/SWIGGY/swiggy@icici",
        "debit",
        userRules,
        overrides,
        "tx-hash-special-lunch"
      );

      // Manual override MUST win
      expect(res.category).toBe("Travel & Commute");
      expect(res.matchedBy).toBe("override");
    });
  });

  describe("Recurring Transaction Detection (30 ± 3 Days)", () => {
    it("flags intervals of 30±3 days and outputs { merchant, amount, nextExpectedDate }", () => {
      const txs = [
        // Netflix recurring monthly subscription (every 30 days)
        { date: "2026-01-15", narration: "ACH D- CITIBANK -NETFLIX ENT-12345", amount: 649, type: "debit" },
        { date: "2026-02-14", narration: "ACH D- CITIBANK -NETFLIX ENT-12345", amount: 649, type: "debit" }, // 30 days diff
        { date: "2026-03-16", narration: "ACH D- CITIBANK -NETFLIX ENT-12345", amount: 649, type: "debit" }, // 30 days diff
      ];

      const recurring = detectRecurringTransactions(txs);

      expect(recurring).toHaveLength(1);
      expect(recurring[0].merchant).toBe("Netflix Ent");
      expect(recurring[0].amount).toBe(649);

      // Next expected date should be 30 days after 2026-03-16 = 2026-04-15
      expect(recurring[0].nextExpectedDate).toBe("2026-04-15");
      expect(recurring[0].occurrences).toBe(3);
    });

    it("flags recurring expenses with intervals within boundary: 27 days and 33 days (30±3)", () => {
      const txs = [
        // Airtel bill: Jan 10 -> Feb 06 (27 days diff, boundary case)
        { date: "2026-01-10", narration: "UPI/123/AIRTEL BROADBAND/airtel@icici", amount: 1179, type: "debit" },
        { date: "2026-02-06", narration: "UPI/456/AIRTEL BROADBAND/airtel@icici", amount: 1179, type: "debit" }, // 27 days
        { date: "2026-03-11", narration: "UPI/789/AIRTEL BROADBAND/airtel@icici", amount: 1179, type: "debit" }, // 33 days
      ];

      const recurring = detectRecurringTransactions(txs);

      expect(recurring).toHaveLength(1);
      expect(recurring[0].merchant).toBe("Airtel Broadband");
      expect(recurring[0].amount).toBe(1179);
      expect(recurring[0].nextExpectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("rejects non-recurring intervals outside 30±3 days (e.g. 10 days, 45 days)", () => {
      const txs = [
        // Random Swiggy orders (frequent, 5 to 10 days interval)
        { date: "2026-01-02", narration: "UPI/1/SWIGGY/swiggy@icici", amount: 500, type: "debit" },
        { date: "2026-01-08", narration: "UPI/2/SWIGGY/swiggy@icici", amount: 500, type: "debit" }, // 6 days
        { date: "2026-01-18", narration: "UPI/3/SWIGGY/swiggy@icici", amount: 500, type: "debit" }, // 10 days
        // Single isolated transaction
        { date: "2026-01-05", narration: "POS 123 ZARA CLOTHING", amount: 4500, type: "debit" },
      ];

      const recurring = detectRecurringTransactions(txs);
      expect(recurring).toHaveLength(0);
    });

    it("groups by similar amounts within tolerance (±5% or ₹50) and separates different tiers", () => {
      const txs = [
        // Electricity bills varying slightly: ₹2,100, ₹2,150, ₹2,080 (within ±5%)
        { date: "2026-01-05", narration: "NEFT-TATA POWER-ELEC", amount: 2100, type: "debit" },
        { date: "2026-02-04", narration: "NEFT-TATA POWER-ELEC", amount: 2150, type: "debit" }, // 30 days
        { date: "2026-03-06", narration: "NEFT-TATA POWER-ELEC", amount: 2080, type: "debit" }, // 30 days
        // Completely different one-off security deposit to same merchant
        { date: "2026-01-15", narration: "NEFT-TATA POWER-ELEC", amount: 25000, type: "debit" },
      ];

      const recurring = detectRecurringTransactions(txs);

      expect(recurring).toHaveLength(1);
      expect(recurring[0].merchant).toBe("Tata Power");
      expect(recurring[0].amount).toBeGreaterThanOrEqual(2000);
      expect(recurring[0].amount).toBeLessThanOrEqual(2200);
      expect(recurring[0].occurrences).toBe(3);
    });
  });
});
