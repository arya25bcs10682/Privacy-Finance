import { encryptJSON, decryptJSON } from "../crypto";
import { apiFetch } from "../api";
import type { BillItem } from "../bills/types";
import type { RecurringExpense } from "../transactions/categorizer";

const LOCAL_STORAGE_BILLS_KEY = "pf_encrypted_bills";

interface EncryptedBillDoc {
  _id: string;
  dueDateMonth?: string;
  encryptedPayload: {
    iv: string;
    ct?: string;
    ciphertext?: string;
  };
}

/**
 * Loads all bills decrypted in browser memory using master dataKey (AES-GCM 256).
 */
export async function loadEncryptedBills(dataKey: CryptoKey): Promise<BillItem[]> {
  let rawPayloadStr = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
  let serverDocs: EncryptedBillDoc[] = [];

  // 1. Try local storage first
  if (!rawPayloadStr) {
    try {
      const res = await apiFetch<{ bills: EncryptedBillDoc[] }>("/bills");
      serverDocs = res.bills || [];
      if (serverDocs.length > 0) {
        rawPayloadStr = JSON.stringify(serverDocs);
        localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, rawPayloadStr);
      }
    } catch {
      // Ignore network errors or unauthenticated state
    }
  } else {
    try {
      serverDocs = JSON.parse(rawPayloadStr);
    } catch {
      serverDocs = [];
    }
  }

  if (!serverDocs || serverDocs.length === 0) {
    return [];
  }

  // 2. Decrypt each bill document in memory
  const decryptedBills = await Promise.all(
    serverDocs.map(async (doc) => {
      try {
        const payload = await decryptJSON<Omit<BillItem, "id">>(
          {
            iv: doc.encryptedPayload.iv,
            ciphertext: doc.encryptedPayload.ct || doc.encryptedPayload.ciphertext || "",
          },
          dataKey
        );
        return {
          id: doc._id,
          ...payload,
        } as BillItem;
      } catch (decErr) {
        console.warn(`Failed to decrypt bill ${doc._id}:`, decErr);
        return null;
      }
    })
  );

  return decryptedBills.filter((b): b is BillItem => b !== null);
}

/**
 * Saves or updates a bill, encrypting it with AES-GCM 256 before persisting to disk/server.
 */
export async function saveEncryptedBill(
  billData: Omit<BillItem, "id"> & { id?: string },
  dataKey: CryptoKey
): Promise<BillItem> {
  const isExisting = Boolean(billData.id && !billData.id.startsWith("local_"));
  const encrypted = await encryptJSON(billData, dataKey);
  const dueDateMonth = billData.nextDueDate ? billData.nextDueDate.substring(0, 7) : undefined;

  let savedDocId = billData.id || `local_${Date.now()}`;

  // 1. Sync to server in zero-knowledge encrypted form
  try {
    if (isExisting && billData.id) {
      const res = await apiFetch<{ bill: { _id: string } }>(`/bills/${billData.id}`, {
        method: "PUT",
        body: JSON.stringify({
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
          dueDateMonth,
        }),
      });
      savedDocId = res.bill._id;
    } else {
      const res = await apiFetch<{ bill: { _id: string } }>("/bills", {
        method: "POST",
        body: JSON.stringify({
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
          dueDateMonth,
        }),
      });
      savedDocId = res.bill._id;
    }
  } catch (err) {
    console.warn("Could not sync encrypted bill to server:", err);
  }

  const savedBill: BillItem = {
    ...billData,
    id: savedDocId,
  };

  // 2. Update local storage cache
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
    const existingList: EncryptedBillDoc[] = raw ? JSON.parse(raw) : [];
    const idx = existingList.findIndex((d) => d._id === savedDocId);

    const newDoc: EncryptedBillDoc = {
      _id: savedDocId,
      dueDateMonth,
      encryptedPayload: {
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      },
    };

    if (idx >= 0) {
      existingList[idx] = newDoc;
    } else {
      existingList.unshift(newDoc);
    }

    localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, JSON.stringify(existingList));
  } catch {
    // Ignore storage quota errors
  }

  return savedBill;
}

/**
 * Deletes a bill by ID from server and local encrypted cache.
 */
export async function deleteEncryptedBill(id: string): Promise<void> {
  if (!id.startsWith("local_")) {
    try {
      await apiFetch(`/bills/${id}`, { method: "DELETE" });
    } catch (err) {
      console.warn("Could not delete bill from server:", err);
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_BILLS_KEY);
    if (raw) {
      const existingList: EncryptedBillDoc[] = JSON.parse(raw);
      const filtered = existingList.filter((d) => d._id !== id);
      localStorage.setItem(LOCAL_STORAGE_BILLS_KEY, JSON.stringify(filtered));
    }
  } catch {
    // Ignore
  }
}

/**
 * Combines auto-detected recurring subscriptions with saved/manual bills without duplicate spamming.
 */
export function mergeBills(detected: RecurringExpense[], savedBills: BillItem[]): BillItem[] {
  const merged: BillItem[] = [...savedBills];
  const savedMerchantNames = new Set(savedBills.map((b) => b.name.toLowerCase().trim()));

  for (const rec of detected) {
    const normName = rec.merchant.toLowerCase().trim();
    if (!savedMerchantNames.has(normName)) {
      merged.push({
        id: `detected_${rec.merchant.replace(/\s+/g, "_")}`,
        name: rec.merchant,
        amount: rec.amount,
        category: "Utilities & Bills",
        nextDueDate: rec.nextExpectedDate,
        cadence: "monthly",
        source: "detected",
        isPaid: false,
      });
      savedMerchantNames.add(normName);
    }
  }

  // Sort upcoming due dates ascending
  merged.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  return merged;
}
