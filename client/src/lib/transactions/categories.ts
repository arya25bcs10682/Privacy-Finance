/**
 * Categorization engine for bank statement narrations.
 * Classifies transactions into standard financial categories based on Indian and global merchants.
 */

export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining": "#22C55E", // Trend Green
  "Housing & Rent": "#3B82F6", // Blue
  "Shopping & Groceries": "#E0E3E6", // Light Main
  "Utilities & Bills": "#F59E0B", // Amber
  "Entertainment": "#EC4899", // Pink
  "Travel & Commute": "#8B5CF6", // Purple
  "Health & Wellness": "#14B8A6", // Teal
  "Income & Salary": "#10B981", // Emerald
  "Investments": "#6366F1", // Indigo
  "General & Others": "#2A2D32", // Active Nav Grey
};

export function categorizeTransaction(narration: string, type: "debit" | "credit" = "debit"): string {
  const clean = narration.toLowerCase();

  // Income / Credits
  if (type === "credit" || /salary|payroll|bonus|dividend|interest|stipend|refund|cashback/i.test(clean)) {
    return "Income & Salary";
  }

  // Investments & Wealth
  if (/sip|mutual\s*fund|zerodha|groww|upstox|nippon|mirae|uti|hdfc\s*mf|sgb|gold/i.test(clean)) {
    return "Investments";
  }

  // Food & Dining
  if (
    /swiggy|zomato|mcdonald|starbucks|domino|pizza|burger|cafe|coffee|restaurant|dine|eats|bakery|chai|tea/i.test(
      clean
    )
  ) {
    return "Food & Dining";
  }

  // Housing & Rent
  if (/rent|maintenance|housing|society|lease|brokerage|landlord|apartment/i.test(clean)) {
    return "Housing & Rent";
  }

  // Shopping & Groceries
  if (
    /amazon|flipkart|myntra|blinkit|zepto|instamart|bigbasket|supermarket|mart|store|retail|zara|h&m|croma|reliancedigital/i.test(
      clean
    )
  ) {
    return "Shopping & Groceries";
  }

  // Utilities & Bills
  if (
    /electricity|mseb|bescom|tata\s*power|broadband|airtel|jio|vodafone|vi\s*bill|wifi|water|gas|cylinder|lpg|billdesk|recharge/i.test(
      clean
    )
  ) {
    return "Utilities & Bills";
  }

  // Entertainment
  if (/netflix|spotify|prime|hotstar|youtube|disney|pvr|inox|bookmyshow|movie|gaming|steam/i.test(clean)) {
    return "Entertainment";
  }

  // Travel & Commute
  if (/uber|ola|rapido|irctc|flight|indigo|air\s*india|petrol|fuel|hpcl|bpcl|ioc|toll|fastag|metro|rail/i.test(clean)) {
    return "Travel & Commute";
  }

  // Health & Wellness
  if (/apollo|pharmeasy|pharmacy|1mg|hospital|clinic|doctor|cult|gym|fitness|med/i.test(clean)) {
    return "Health & Wellness";
  }

  return "General & Others";
}
