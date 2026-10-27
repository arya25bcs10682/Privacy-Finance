import { describe, it, expect } from "vitest";
import { computeBillReminders } from "./reminders";
import type { BillItem } from "./types";

describe("Client-Side Bill Reminders Engine", () => {
  const referenceDate = new Date("2026-03-15T00:00:00Z");

  const sampleBills: BillItem[] = [
    {
      id: "b1",
      name: "Overdue Electricity",
      amount: 2100,
      category: "Utilities & Bills",
      nextDueDate: "2026-03-12", // 3 days overdue relative to Mar 15
      cadence: "monthly",
      source: "manual",
      isPaid: false,
    },
    {
      id: "b2",
      name: "Airtel Broadband",
      amount: 1179,
      category: "Utilities & Bills",
      nextDueDate: "2026-03-15", // Due today relative to Mar 15
      cadence: "monthly",
      source: "detected",
      isPaid: false,
    },
    {
      id: "b3",
      name: "Netflix Premium",
      amount: 649,
      category: "Entertainment",
      nextDueDate: "2026-03-18", // Due in 3 days
      cadence: "monthly",
      source: "detected",
      isPaid: false,
    },
    {
      id: "b4",
      name: "Cult.fit Gym",
      amount: 1450,
      category: "Health & Wellness",
      nextDueDate: "2026-03-28", // Due in 13 days (> 7 days, upcoming)
      cadence: "monthly",
      source: "manual",
      isPaid: false,
    },
    {
      id: "b5",
      name: "Paid Rent",
      amount: 25000,
      category: "Housing & Rent",
      nextDueDate: "2026-03-10",
      cadence: "monthly",
      source: "manual",
      isPaid: true, // Already marked as paid -> should be skipped!
    },
  ];

  it("identifies overdue, due today, due soon, and upcoming bills", () => {
    const reminders = computeBillReminders(sampleBills, referenceDate);

    // Paid bill must be excluded
    expect(reminders.some((r) => r.billId === "b5")).toBe(false);
    expect(reminders).toHaveLength(4);

    // 1. Overdue bill
    const overdue = reminders.find((r) => r.billId === "b1")!;
    expect(overdue.status).toBe("overdue");
    expect(overdue.daysRemaining).toBe(-3);
    expect(overdue.message).toContain("Overdue Electricity is overdue by 3 days");

    // 2. Due today bill
    const dueToday = reminders.find((r) => r.billId === "b2")!;
    expect(dueToday.status).toBe("due_today");
    expect(dueToday.daysRemaining).toBe(0);
    expect(dueToday.message).toContain("Airtel Broadband is due today");

    // 3. Due soon bill (within 7 days)
    const dueSoon = reminders.find((r) => r.billId === "b3")!;
    expect(dueSoon.status).toBe("due_soon");
    expect(dueSoon.daysRemaining).toBe(3);
    expect(dueSoon.message).toContain("Netflix Premium is due in 3 days");

    // 4. Upcoming bill (> 7 days)
    const upcoming = reminders.find((r) => r.billId === "b4")!;
    expect(upcoming.status).toBe("upcoming");
    expect(upcoming.daysRemaining).toBe(13);
  });

  it("sorts reminders strictly by urgency (overdue first, then due today, then upcoming)", () => {
    const reminders = computeBillReminders(sampleBills, referenceDate);

    expect(reminders[0].billId).toBe("b1"); // -3 days
    expect(reminders[1].billId).toBe("b2"); // 0 days
    expect(reminders[2].billId).toBe("b3"); // 3 days
    expect(reminders[3].billId).toBe("b4"); // 13 days
  });
});
