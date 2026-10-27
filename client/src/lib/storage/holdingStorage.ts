import { encryptJSON, decryptJSON } from "../crypto";
import { apiFetch } from "../api";
import type { HoldingItem } from "../holdings/types";

const LOCAL_STORAGE_HOLDINGS_KEY = "pf_encrypted_holdings";

interface EncryptedHoldingDoc {
  _id: string;
  assetClass?: string;
  encryptedPayload: {
    iv: string;
    ct?: string;
    ciphertext?: string;
  };
}

/**
 * Loads all holdings decrypted in memory using master dataKey (AES-GCM 256).
 * Never exposes plaintext holdings to the server or persistent unencrypted storage.
 */
export async function loadEncryptedHoldings(dataKey: CryptoKey): Promise<HoldingItem[]> {
  let rawPayloadStr = localStorage.getItem(LOCAL_STORAGE_HOLDINGS_KEY);
  let serverDocs: EncryptedHoldingDoc[] = [];

  // 1. Try local storage first or sync from server
  if (!rawPayloadStr) {
    try {
      const res = await apiFetch<{ holdings: EncryptedHoldingDoc[] }>("/holdings");
      serverDocs = res.holdings || [];
      if (serverDocs.length > 0) {
        rawPayloadStr = JSON.stringify(serverDocs);
        localStorage.setItem(LOCAL_STORAGE_HOLDINGS_KEY, rawPayloadStr);
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

  // 2. Decrypt each holding document in client memory
  const decryptedHoldings = await Promise.all(
    serverDocs.map(async (doc) => {
      try {
        const payload = await decryptJSON<Omit<HoldingItem, "id">>(
          {
            iv: doc.encryptedPayload.iv,
            ciphertext: doc.encryptedPayload.ct || doc.encryptedPayload.ciphertext || "",
          },
          dataKey
        );
        return {
          id: doc._id,
          ...payload,
        } as HoldingItem;
      } catch (decErr) {
        console.warn(`Failed to decrypt holding ${doc._id}:`, decErr);
        return null;
      }
    })
  );

  return decryptedHoldings.filter((h): h is HoldingItem => h !== null);
}

/**
 * Saves or updates a holding, encrypting it with AES-GCM 256 before persisting.
 */
export async function saveEncryptedHolding(
  holdingData: Omit<HoldingItem, "id"> & { id?: string },
  dataKey: CryptoKey
): Promise<HoldingItem> {
  const isExisting = Boolean(holdingData.id && !holdingData.id.startsWith("local_"));
  const encrypted = await encryptJSON(holdingData, dataKey);
  const assetClass = holdingData.assetType || "stock";

  let savedDocId = holdingData.id || `local_${Date.now()}`;

  // 1. Sync to server in zero-knowledge encrypted form
  try {
    if (isExisting && holdingData.id) {
      const res = await apiFetch<{ holding: { _id: string } }>(`/holdings/${holdingData.id}`, {
        method: "PUT",
        body: JSON.stringify({
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
          assetClass,
        }),
      });
      savedDocId = res.holding._id;
    } else {
      const res = await apiFetch<{ holding: { _id: string } }>("/holdings", {
        method: "POST",
        body: JSON.stringify({
          encryptedPayload: {
            iv: encrypted.iv,
            ct: encrypted.ciphertext,
          },
          assetClass,
        }),
      });
      savedDocId = res.holding._id;
    }
  } catch (err) {
    console.warn("Could not sync encrypted holding to server:", err);
  }

  const savedHolding: HoldingItem = {
    ...holdingData,
    id: savedDocId,
  };

  // 2. Update local storage cache
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HOLDINGS_KEY);
    const existingList: EncryptedHoldingDoc[] = raw ? JSON.parse(raw) : [];
    const idx = existingList.findIndex((d) => d._id === savedDocId);

    const newDoc: EncryptedHoldingDoc = {
      _id: savedDocId,
      assetClass,
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

    localStorage.setItem(LOCAL_STORAGE_HOLDINGS_KEY, JSON.stringify(existingList));
  } catch {
    // Ignore storage quota errors
  }

  return savedHolding;
}

/**
 * Deletes a holding from server and local storage.
 */
export async function deleteEncryptedHolding(id: string): Promise<void> {
  try {
    if (!id.startsWith("local_")) {
      await apiFetch(`/holdings/${id}`, { method: "DELETE" });
    }
  } catch (err) {
    console.warn("Failed to delete holding from server:", err);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HOLDINGS_KEY);
    if (raw) {
      const existingList: EncryptedHoldingDoc[] = JSON.parse(raw);
      const filtered = existingList.filter((d) => d._id !== id);
      localStorage.setItem(LOCAL_STORAGE_HOLDINGS_KEY, JSON.stringify(filtered));
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Purges encrypted holdings from local storage (e.g. on vault lock or logout)
 */
export function purgeEncryptedHoldings(): void {
  try {
    localStorage.removeItem(LOCAL_STORAGE_HOLDINGS_KEY);
  } catch {
    // Ignore
  }
}
