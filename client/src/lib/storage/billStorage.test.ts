import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadEncryptedBills,
  saveEncryptedBill,
  deleteEncryptedBill,
  mergeBills,
} from "./billStorage";
import { generateDataKey } from "../crypto";
import * as api from "../api";
import type { RecurringExpense } from "../transactions/categorizer";
import type { BillItem } from "../bills/types";

describe("Encrypted Bill Storage (billStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves and loads bills encrypted with AES-GCM 256 without sending plaintext details", async () => {
    const dataKey = await generateDataKey();

    const sampleBill: Omit<BillItem, "id"> = {
      name: "Secret Gym Subscription",
      amount: 1500,
      category: "Health & Wellness",
      nextDueDate: "2026-04-01",
      cadence: "monthly",
      source: "manual",
      isPaid: false,
    };

    const postSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({
      bill: { _id: "server-bill-doc-1" },
    });

    const saved = await saveEncryptedBill(sampleBill, dataKey);
    expect(saved.id).toBe("server-bill-doc-1");

    // 1. Verify localStorage is encrypted
    const rawStored = localStorage.getItem("pf_encrypted_bills");
    expect(rawStored).not.toBeNull();
    expect(rawStored).not.toContain("Secret Gym Subscription");
    expect(rawStored).not.toContain("1500");

    const parsed = JSON.parse(rawStored!);
    expect(parsed[0].encryptedPayload).toHaveProperty("iv");
    expect(parsed[0].encryptedPayload).toHaveProperty("ciphertext");

    // 2. Verify server payload only receives encryptedPayload
    expect(postSpy).toHaveBeenCalledWith(
      "/bills",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"encryptedPayload"'),
      })
    );

    // 3. Decrypt and load back in memory
    const loaded = await loadEncryptedBills(dataKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Secret Gym Subscription");
    expect(loaded[0].amount).toBe(1500);
    expect(loaded[0].isPaid).toBe(false);
  });

  it("deletes encrypted bills from server and local cache", async () => {
    const deleteSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({ message: "Deleted" });

    // Populate local cache
    localStorage.setItem(
      "pf_encrypted_bills",
      JSON.stringify([{ _id: "bill-to-delete", encryptedPayload: { iv: "iv", ct: "ct" } }])
    );

    await deleteEncryptedBill("bill-to-delete");

    expect(deleteSpy).toHaveBeenCalledWith("/bills/bill-to-delete", { method: "DELETE" });
    const raw = localStorage.getItem("pf_encrypted_bills");
    expect(JSON.parse(raw!)).toEqual([]);
  });

  it("merges auto-detected bills with user's saved bills without creating duplicate entries", () => {
    const detected: RecurringExpense[] = [
      { merchant: "Netflix Premium", amount: 649, nextExpectedDate: "2026-03-22" },
      { merchant: "Airtel Broadband", amount: 1179, nextExpectedDate: "2026-03-18" },
    ];

    const savedBills: BillItem[] = [
      {
        id: "saved-1",
        name: "Netflix Premium", // Same merchant name already saved
        amount: 649,
        category: "Entertainment",
        nextDueDate: "2026-03-22",
        cadence: "monthly",
        source: "manual",
        isPaid: true, // Marked as paid by user
      },
      {
        id: "saved-2",
        name: "MSEB Electricity",
        amount: 2000,
        category: "Utilities & Bills",
        nextDueDate: "2026-03-12",
        cadence: "monthly",
        source: "manual",
        isPaid: false,
      },
    ];

    const merged = mergeBills(detected, savedBills);

    // Total should be 3 (saved Netflix, saved MSEB, and detected Airtel Broadband)
    expect(merged).toHaveLength(3);

    // The user's saved Netflix (which is marked as paid) must be preserved, NOT duplicated!
    const netflix = merged.find((b) => b.name.toLowerCase() === "netflix premium")!;
    expect(netflix.id).toBe("saved-1");
    expect(netflix.isPaid).toBe(true);

    // Detected Airtel Broadband should be present
    const airtel = merged.find((b) => b.name.toLowerCase() === "airtel broadband")!;
    expect(airtel.source).toBe("detected");
    expect(airtel.amount).toBe(1179);
  });
});
