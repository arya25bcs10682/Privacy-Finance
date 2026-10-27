import { encryptJSON, decryptJSON } from "../crypto";
import { apiFetch } from "../api";

export const DEFAULT_CATEGORY_LIMITS: Record<string, number> = {
  "Housing & Rent": 25000,
  "Food & Dining": 12000,
  "Shopping & Groceries": 8000,
  "Utilities & Bills": 6000,
  "Entertainment": 4000,
  "Travel & Commute": 5000,
  "Health & Wellness": 3000,
  "Investments": 15000,
  "General & Others": 5000,
};

export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface DecryptedBudgetDoc {
  id?: string;
  month: string;
  limits: Record<string, number>;
  periods: Record<string, BudgetPeriod>;
}

interface EncryptedBudgetDoc {
  _id: string;
  month: string;
  encryptedPayload: {
    iv: string;
    ct?: string;
    ciphertext?: string;
  };
}

const getLocalStorageBudgetKey = (month: string) => `pf_encrypted_budget_${month}`;

function getDefaultPeriods(limits: Record<string, number>): Record<string, BudgetPeriod> {
  const periods: Record<string, BudgetPeriod> = {};
  for (const cat of Object.keys(limits)) {
    periods[cat] = "monthly";
  }
  return periods;
}

/**
 * Loads category budget limits and periods for a given month, decrypted using master dataKey (AES-GCM 256).
 */
export async function loadBudgetForMonth(
  month: string,
  dataKey: CryptoKey
): Promise<DecryptedBudgetDoc> {
  const localKey = getLocalStorageBudgetKey(month);
  let rawPayloadStr = localStorage.getItem(localKey);
  let serverDocId: string | undefined;

  // 1. If not found in localStorage, fetch from server
  if (!rawPayloadStr) {
    try {
      const res = await apiFetch<{ budgets: EncryptedBudgetDoc[] }>(`/budgets?month=${month}`);
      if (res.budgets && res.budgets.length > 0) {
        const doc = res.budgets[0];
        serverDocId = doc._id;
        rawPayloadStr = JSON.stringify({
          id: doc._id,
          iv: doc.encryptedPayload.iv,
          ciphertext: doc.encryptedPayload.ct || doc.encryptedPayload.ciphertext,
        });
        localStorage.setItem(localKey, rawPayloadStr);
      }
    } catch {
      // Ignore network errors or unauthenticated state
    }
  }

  if (!rawPayloadStr) {
    return {
      month,
      limits: { ...DEFAULT_CATEGORY_LIMITS },
      periods: getDefaultPeriods(DEFAULT_CATEGORY_LIMITS),
    };
  }

  try {
    const payload = JSON.parse(rawPayloadStr);
    serverDocId = payload.id || serverDocId;
    const decrypted = await decryptJSON<{
      limits?: Record<string, number>;
      periods?: Record<string, BudgetPeriod>;
    }>(
      {
        iv: payload.iv,
        ciphertext: payload.ciphertext || payload.ct,
      },
      dataKey
    );

    const limits = { ...DEFAULT_CATEGORY_LIMITS, ...(decrypted.limits || {}) };
    const savedPeriods = decrypted.periods || {};
    const periods: Record<string, BudgetPeriod> = {};
    for (const cat of Object.keys(limits)) {
      periods[cat] = savedPeriods[cat] || "monthly";
    }

    return {
      id: serverDocId,
      month,
      limits,
      periods,
    };
  } catch (err) {
    console.warn(`Failed to decrypt budget for ${month} with current dataKey:`, err);
    return {
      month,
      limits: { ...DEFAULT_CATEGORY_LIMITS },
      periods: getDefaultPeriods(DEFAULT_CATEGORY_LIMITS),
    };
  }
}

/**
 * Saves category budget limits and periods for a given month, encrypting them with AES-GCM 256 before persisting.
 */
export async function saveBudgetForMonth(
  month: string,
  limits: Record<string, number>,
  periodsOrDataKey: Record<string, BudgetPeriod> | CryptoKey,
  dataKeyOrExistingBudgetId?: CryptoKey | string,
  maybeExistingBudgetId?: string
): Promise<string | undefined> {
  let periods: Record<string, BudgetPeriod> = {};
  let dataKey: CryptoKey;
  let existingBudgetId: string | undefined;

  if (periodsOrDataKey && typeof periodsOrDataKey === "object" && "algorithm" in periodsOrDataKey) {
    // Signature was: saveBudgetForMonth(month, limits, dataKey, existingBudgetId)
    dataKey = periodsOrDataKey as CryptoKey;
    existingBudgetId = dataKeyOrExistingBudgetId as string | undefined;
    periods = getDefaultPeriods(limits);
  } else {
    // Signature is: saveBudgetForMonth(month, limits, periods, dataKey, existingBudgetId)
    periods = (periodsOrDataKey as Record<string, BudgetPeriod>) || getDefaultPeriods(limits);
    dataKey = dataKeyOrExistingBudgetId as CryptoKey;
    existingBudgetId = maybeExistingBudgetId;
  }

  const localKey = getLocalStorageBudgetKey(month);

  // 1. Encrypt limits and periods payload with master AES-GCM dataKey
  const encrypted = await encryptJSON({ limits, periods }, dataKey);

  // 2. Sync to server in zero-knowledge encrypted format
  let savedId = existingBudgetId;
  try {
    if (existingBudgetId) {
      await apiFetch(`/budgets/${existingBudgetId}`, {
        method: "PUT",
        body: JSON.stringify({
          month,
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
        }),
      });
    } else {
      const res = await apiFetch<{ budget: { _id: string } }>("/budgets", {
        method: "POST",
        body: JSON.stringify({
          month,
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
        }),
      });
      savedId = res.budget?._id;
    }
  } catch (err) {
    console.warn(`Could not sync encrypted budget to server for ${month}:`, err);
  }

  // 3. Save locally in encrypted format
  const payloadToStore = {
    id: savedId,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };
  localStorage.setItem(localKey, JSON.stringify(payloadToStore));

  return savedId;
}
