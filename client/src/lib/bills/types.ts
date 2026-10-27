export interface BillItem {
  id: string; // server doc id or client id
  name: string; // Merchant / service name (e.g. "Netflix Premium", "Airtel Broadband")
  amount: number;
  category: string;
  nextDueDate: string; // ISO date string YYYY-MM-DD
  dayOfMonth?: number;
  cadence: "monthly" | "yearly" | "quarterly" | "weekly";
  source: "detected" | "manual";
  isPaid: boolean;
  lastPaidDate?: string; // ISO date string YYYY-MM-DD
  notes?: string;
}

export interface BillReminder {
  billId: string;
  name: string;
  amount: number;
  dueDate: string;
  daysRemaining: number;
  status: "overdue" | "due_today" | "due_soon" | "upcoming";
  message: string;
}
