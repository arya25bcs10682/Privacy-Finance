/**
 * Rule-Based Categorizer & Recurring Transaction Detector
 *
 * Provides:
 * 1. Merchant pattern matching and clean merchant extraction for UPI, NEFT, ACH, IMPS, POS narrations.
 * 2. Rule evaluation hierarchy: Manual Override -> User-Editable Rules -> Built-in Defaults.
 * 3. Recurring detection: Group by cleaned merchant & similar amount, flag intervals of 30±3 days,
 *    and output { merchant, amount, nextExpectedDate }.
 */

export interface CategorizationRule {
  id: string;
  pattern: string;
  category: string;
  matchType?: "contains" | "exact" | "regex";
}

export interface UserRulesAndOverrides {
  rules: CategorizationRule[];
  overrides: Record<string, string>; // txHash or txId -> category
}

export interface CategorizationResult {
  category: string;
  merchant: string;
  matchedBy: "override" | "user_rule" | "default";
  matchedRuleId?: string;
}

export interface RecurringExpense {
  merchant: string;
  amount: number;
  nextExpectedDate: string; // ISO YYYY-MM-DD
  intervalDays?: number;
  occurrences?: number;
  lastDate?: string;
}

/**
 * Extracts a clean, normalized merchant name from complex bank narrations:
 * - UPI: "UPI/402918239102/SWIGGY/paytm-123@paytm/Payment from Ph" -> "Swiggy"
 * - UPI: "UPI-ZEPTO-zepto@axisbank-Ref 384920" -> "Zepto"
 * - NEFT: "NEFT CR-HDFC0000240-ACME CORP-OCTOBER 2026" -> "Acme Corp"
 * - ACH: "ACH D- CITIBANK -NETFLIX ENT-12345678" -> "Netflix Ent"
 * - IMPS: "IMPS/P2A/402918239102/AMAZON PAY/HDFC/" -> "Amazon Pay"
 * - POS: "POS 402918239102 RELIANCE FRESH MUMBAI" -> "Reliance Fresh"
 */
export function extractCleanMerchant(narration: string): string {
  if (!narration || !narration.trim()) return "Unknown Merchant";
  let clean = narration.trim();

  // 1. UPI narrations
  if (/^UPI[/\-_]/i.test(clean) || clean.toUpperCase().includes("UPI/")) {
    const upiBody = clean.replace(/^UPI[/\-_]/i, "");
    const parts = upiBody.split(/[/\-_]/).map((p) => p.trim()).filter(Boolean);

    const candidates = parts.filter(
      (p) =>
        p.length > 1 &&
        !/^\d+$/.test(p) && // not pure numeric digits
        !/^(DR|CR|P2A|P2M|UPI|PAY|REFUND|TRANSFER|NA|BIL)$/i.test(p) &&
        !/@/.test(p) && // not VPA handle
        !/^(YESB|HDFC|ICIC|ICICI|UTIB|SBIN|SBI|BARB|KKBK|KOTAK|PUNB|CNRB|INDB|AXIS)[A-Z0-9]*$/i.test(p)
    );

    if (candidates.length > 0) {
      clean = candidates[0];
    } else {
      // Check VPA handle
      const vpaMatch = upiBody.match(/([a-zA-Z0-9._-]+)@([a-zA-Z]+)/);
      if (vpaMatch && vpaMatch[1]) {
        clean = vpaMatch[1].replace(/[-_.]/g, " ");
      }
    }
  }
  // 2. NEFT narrations (e.g., NEFT CR-HDFC0000240-ACME CORP-SALARY)
  else if (/^NEFT[\s\-_]/i.test(clean)) {
    const neftBody = clean.replace(/^NEFT[\s\-_]*(DEBIT|CREDIT|DR|CR|D|C)?[\s\-_]*/i, "");
    const parts = neftBody.split(/[/\-_]/).map((p) => p.trim()).filter(Boolean);
    const candidates = parts.filter(
      (p) =>
        p.length > 1 &&
        !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(p) && // not IFSC
        !/^\d+$/.test(p) &&
        !/^(TRANSFER|SALARY|PAYMENT|N\d+|CMS|RTGS|BIL|DEBIT|CREDIT|DR|CR)$/i.test(p) &&
        !/^(YESB|HDFC|ICIC|ICICI|UTIB|SBIN|SBI|BARB|KKBK|KOTAK|PUNB|CNRB|INDB|AXIS)[A-Z0-9]*$/i.test(p)
    );
    if (candidates.length > 0) {
      clean = candidates[0];
    } else {
      clean = neftBody;
    }
  }
  // 3. ACH / NACH narrations (e.g., ACH D- CITIBANK -NETFLIX ENT-12345678)
  else if (/^(ACH|NACH)[\s\-_/]/i.test(clean)) {
    const achBody = clean.replace(/^(ACH|NACH)[\s\-_/]*(DEBIT|CREDIT|DR|CR|D|C)?[\s\-_/]*/i, "");
    const parts = achBody.split(/[/\-_]/).map((p) => p.trim()).filter(Boolean);
    const candidates = parts.filter(
      (p) =>
        p.length > 1 &&
        !/^\d+$/.test(p) &&
        !/^(CITIBANK|HDFC|ICICI|ICIC|AXIS|UTIB|SBI|SBIN|KOTAK|KKBK|INDUSIND|INDB|STANDARD|CHASE)[A-Z0-9]*$/i.test(p) &&
        !/^(TRANSFER|MANDATE|ECS|NACH|SIP|PREMIUM|BIL|DEBIT|CREDIT|DR|CR)$/i.test(p)
    );
    if (candidates.length > 0) {
      clean = candidates[0];
    } else {
      clean = achBody;
    }
  }
  // 4. IMPS narrations (e.g., IMPS/P2A/402918239102/AMAZON PAY/HDFC/)
  else if (/^IMPS[/\-_]/i.test(clean)) {
    const impsBody = clean.replace(/^IMPS[/\-_]*(P2A|P2M|DR|CR|RET|MB)?[/\-_]*/i, "");
    const parts = impsBody.split(/[/\-_]/).map((p) => p.trim()).filter(Boolean);
    const candidates = parts.filter(
      (p) =>
        p.length > 1 &&
        !/^\d+$/.test(p) &&
        !/^(YESB|HDFC|ICIC|ICICI|UTIB|SBIN|SBI|BARB|KKBK|KOTAK|PUNB|CNRB|INDB|AXIS)[A-Z0-9]*$/i.test(p) &&
        !/^(P2A|P2M|TRANSFER|RET|MB|BIL|DR|CR)$/i.test(p)
    );
    if (candidates.length > 0) {
      clean = candidates[0];
    } else {
      clean = impsBody;
    }
  }
  // 5. Card / POS / E-Commerce prefixes
  else {
    clean = clean.replace(/^(POS|E-COM|ATM|BIL|INB|INF|IPS)[\s\-_/]+/i, "");
  }

  // Remove common geographic noise, terminal IDs, and long reference codes
  clean = clean
    .replace(/\b(BANGALORE|BENGALURU|MUMBAI|DELHI|GURGAON|HYDERABAD|CHENNAI|PUNE|KOLKATA|NOIDA|IN|IND)\b/gi, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/[^a-zA-Z0-9\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "Unknown Merchant";

  // Format in Title Case for clean presentation
  return clean
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Built-in merchant pattern matching across Indian and global providers.
 */
export function matchBuiltinCategory(
  narration: string,
  merchant: string,
  type: "debit" | "credit" = "debit"
): string {
  const combined = `${narration} ${merchant}`.toLowerCase();

  // Income / Credits
  if (type === "credit" || /salary|payroll|bonus|dividend|interest|stipend|refund|cashback/i.test(combined)) {
    return "Income & Salary";
  }

  // Investments & Wealth
  if (/sip|mutual\s*fund|zerodha|groww|upstox|nippon|mirae|uti|hdfc\s*mf|sgb|gold|coin|kuvera/i.test(combined)) {
    return "Investments";
  }

  // Food & Dining
  if (
    /swiggy|zomato|mcdonald|starbucks|domino|pizza|burger|cafe|coffee|restaurant|dine|eats|bakery|chai|tea|subway|kfc/i.test(
      combined
    )
  ) {
    return "Food & Dining";
  }

  // Housing & Rent
  if (/rent|maintenance|housing|society|lease|brokerage|landlord|apartment|nobroker|mygate/i.test(combined)) {
    return "Housing & Rent";
  }

  // Shopping & Groceries
  if (
    /amazon|flipkart|myntra|blinkit|zepto|instamart|bigbasket|supermarket|mart|store|retail|zara|h&m|croma|reliancedigital|ikea/i.test(
      combined
    )
  ) {
    return "Shopping & Groceries";
  }

  // Utilities & Bills
  if (
    /electricity|mseb|bescom|tata\s*power|broadband|airtel|jio|vodafone|vi\s*bill|wifi|water|gas|cylinder|lpg|billdesk|recharge|dth/i.test(
      combined
    )
  ) {
    return "Utilities & Bills";
  }

  // Entertainment
  if (/netflix|spotify|prime|hotstar|youtube|disney|pvr|inox|bookmyshow|movie|gaming|steam|playstation/i.test(combined)) {
    return "Entertainment";
  }

  // Travel & Commute
  if (
    /uber|ola|rapido|irctc|flight|indigo|air\s*india|petrol|fuel|hpcl|bpcl|ioc|toll|fastag|metro|rail|makemytrip/i.test(
      combined
    )
  ) {
    return "Travel & Commute";
  }

  // Health & Wellness
  if (/apollo|pharmeasy|pharmacy|1mg|hospital|clinic|doctor|cult|gym|fitness|medplus|netmeds/i.test(combined)) {
    return "Health & Wellness";
  }

  return "General & Others";
}

/**
 * Categorizes a transaction using the strict 3-tier hierarchy:
 * 1. Manual override per transaction (highest precedence)
 * 2. User-editable custom rules (second precedence, in order)
 * 3. Built-in merchant pattern matching (default)
 */
export function categorizeTransactionWithRules(
  narration: string,
  type: "debit" | "credit" = "debit",
  userRules: CategorizationRule[] = [],
  overrides: Record<string, string> = {},
  txIdentifier?: string
): CategorizationResult {
  const merchant = extractCleanMerchant(narration);

  // 1. Manual override per transaction
  if (txIdentifier && overrides[txIdentifier]) {
    return {
      category: overrides[txIdentifier],
      merchant,
      matchedBy: "override",
    };
  }

  const rawLower = narration.toLowerCase();
  const merchantLower = merchant.toLowerCase();

  // 2. User-editable rules
  for (const rule of userRules) {
    if (!rule.pattern || !rule.category) continue;
    const matchType = rule.matchType || "contains";

    if (matchType === "contains") {
      const pat = rule.pattern.toLowerCase();
      if (rawLower.includes(pat) || merchantLower.includes(pat)) {
        return {
          category: rule.category,
          merchant,
          matchedBy: "user_rule",
          matchedRuleId: rule.id,
        };
      }
    } else if (matchType === "exact") {
      const pat = rule.pattern.toLowerCase();
      if (merchantLower === pat || rawLower === pat) {
        return {
          category: rule.category,
          merchant,
          matchedBy: "user_rule",
          matchedRuleId: rule.id,
        };
      }
    } else if (matchType === "regex") {
      try {
        const regex = new RegExp(rule.pattern, "i");
        if (regex.test(narration) || regex.test(merchant)) {
          return {
            category: rule.category,
            merchant,
            matchedBy: "user_rule",
            matchedRuleId: rule.id,
          };
        }
      } catch {
        // Invalid regex skipped safely
      }
    }
  }

  // 3. Built-in defaults
  const defaultCategory = matchBuiltinCategory(narration, merchant, type);
  return {
    category: defaultCategory,
    merchant,
    matchedBy: "default",
  };
}

/**
 * Recurring Transaction Detection Algorithm:
 * - Groups debit transactions by cleaned merchant.
 * - Subgroups by similar amount (within ±5% or ₹50 delta).
 * - Sorts by date and flags intervals of 30±3 days (27 <= intervalDays <= 33).
 * - Projects nextExpectedDate = lastDate + averageInterval (or 30 days).
 * - Returns array of { merchant, amount, nextExpectedDate }.
 */
export function detectRecurringTransactions(
  transactions: Array<{
    date: string; // ISO date string (YYYY-MM-DD)
    narration: string;
    amount: number;
    type?: string;
  }>
): RecurringExpense[] {
  // Only debit transactions represent recurring payments/subscriptions/bills
  const debits = transactions.filter((t) => (t.type ? t.type === "debit" : true));

  // 1. Group by cleaned merchant
  const merchantMap = new Map<string, Array<{ date: string; amount: number; narration: string }>>();
  for (const tx of debits) {
    const merchant = extractCleanMerchant(tx.narration);
    if (!merchantMap.has(merchant)) {
      merchantMap.set(merchant, []);
    }
    merchantMap.get(merchant)!.push({
      date: tx.date,
      amount: Math.abs(tx.amount),
      narration: tx.narration,
    });
  }

  const results: RecurringExpense[] = [];

  for (const [merchant, txs] of merchantMap.entries()) {
    if (txs.length < 2) continue;

    // 2. Group by similar amount (within ±5% delta or ₹50)
    const amountClusters: Array<{
      representativeAmount: number;
      items: Array<{ date: string; amount: number }>;
    }> = [];

    for (const item of txs) {
      let matchedCluster = false;
      for (const cluster of amountClusters) {
        const diff = Math.abs(item.amount - cluster.representativeAmount);
        const maxVal = Math.max(item.amount, cluster.representativeAmount);
        const pctDiff = maxVal > 0 ? diff / maxVal : 0;

        if (pctDiff <= 0.05 || diff <= 50) {
          cluster.items.push(item);
          // Keep cluster representative amount as running average
          cluster.representativeAmount = Math.round(
            cluster.items.reduce((sum, c) => sum + c.amount, 0) / cluster.items.length
          );
          matchedCluster = true;
          break;
        }
      }

      if (!matchedCluster) {
        amountClusters.push({
          representativeAmount: item.amount,
          items: [item],
        });
      }
    }

    // 3. For each cluster with at least 2 transactions, evaluate date intervals
    for (const cluster of amountClusters) {
      if (cluster.items.length < 2) continue;

      // Sort chronologically ascending
      const sorted = [...cluster.items].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const matchingIntervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const d1 = new Date(sorted[i - 1].date);
        const d2 = new Date(sorted[i].date);
        const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

        // Flag intervals of 30±3 days (27 to 33 days)
        if (diffDays >= 27 && diffDays <= 33) {
          matchingIntervals.push(diffDays);
        }
      }

      // If at least one interval is 30±3 days, flag as recurring
      if (matchingIntervals.length > 0) {
        const avgInterval = Math.round(
          matchingIntervals.reduce((a, b) => a + b, 0) / matchingIntervals.length
        );

        const lastItem = sorted[sorted.length - 1];
        const lastDate = new Date(lastItem.date);

        // Project next expected date: lastDate + avgInterval days
        const nextDate = new Date(lastDate);
        nextDate.setDate(nextDate.getDate() + (avgInterval || 30));

        const nextExpectedDate = nextDate.toISOString().split("T")[0];

        results.push({
          merchant,
          amount: cluster.representativeAmount,
          nextExpectedDate,
          intervalDays: avgInterval,
          occurrences: sorted.length,
          lastDate: lastItem.date,
        });
      }
    }
  }

  // Sort upcoming recurring bills by nextExpectedDate ascending
  results.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));

  return results;
}
