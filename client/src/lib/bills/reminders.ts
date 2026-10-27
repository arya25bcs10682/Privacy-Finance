import type { BillItem, BillReminder } from "./types";

/**
 * Computes bill reminders strictly on the client side:
 * - Flags overdue bills (daysRemaining < 0)
 * - Flags bills due today (daysRemaining === 0)
 * - Flags bills due soon (0 < daysRemaining <= 7)
 * - Excludes bills marked as paid
 */
export function computeBillReminders(bills: BillItem[], referenceDate?: Date): BillReminder[] {
  const today = referenceDate ? new Date(referenceDate) : new Date();
  today.setHours(0, 0, 0, 0);

  const unpaid = bills.filter((b) => !b.isPaid);
  const reminders: BillReminder[] = [];

  for (const bill of unpaid) {
    if (!bill.nextDueDate) continue;

    const parts = bill.nextDueDate.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const dueDate = new Date(year, month, day);
    dueDate.setHours(0, 0, 0, 0);

    const diffMs = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));

    let status: "overdue" | "due_today" | "due_soon" | "upcoming" = "upcoming";
    let message = `${bill.name} is due on ${bill.nextDueDate} (₹${bill.amount.toLocaleString("en-IN")})`;

    if (daysRemaining < 0) {
      status = "overdue";
      const overdueDays = Math.abs(daysRemaining);
      message = `${bill.name} is overdue by ${overdueDays} ${overdueDays === 1 ? "day" : "days"} (₹${bill.amount.toLocaleString("en-IN")})!`;
    } else if (daysRemaining === 0) {
      status = "due_today";
      message = `${bill.name} is due today (₹${bill.amount.toLocaleString("en-IN")})!`;
    } else if (daysRemaining <= 7) {
      status = "due_soon";
      message = `${bill.name} is due in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} (₹${bill.amount.toLocaleString("en-IN")})`;
    }

    reminders.push({
      billId: bill.id,
      name: bill.name,
      amount: bill.amount,
      dueDate: bill.nextDueDate,
      daysRemaining,
      status,
      message,
    });
  }

  // Sort most urgent first (overdue -> due today -> due soon -> upcoming)
  reminders.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return reminders;
}
