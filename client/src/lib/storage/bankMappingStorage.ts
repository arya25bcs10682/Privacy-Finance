import { encryptJSON, decryptJSON } from "../crypto";
import { apiFetch } from "../api";
import type { BankColumnMapping } from "../tabular/parser";

const LOCAL_STORAGE_KEY = "pf_encrypted_bank_mappings";

export interface EncryptedMappingsPayload {
  iv: string;
  ct: string;
  ciphertext?: string;
}

/**
 * Loads all saved bank mappings, decrypted in memory using the user's master dataKey.
 */
export async function getAllBankMappings(
  dataKey: CryptoKey
): Promise<Record<string, BankColumnMapping>> {
  // 1. Try local storage first
  let rawPayloadStr = localStorage.getItem(LOCAL_STORAGE_KEY);

  // 2. Fall back to server if not found in local storage
  if (!rawPayloadStr) {
    try {
      const res = await apiFetch<{ encryptedMappings: EncryptedMappingsPayload | null }>(
        "/auth/mappings"
      );
      if (res.encryptedMappings && res.encryptedMappings.iv && (res.encryptedMappings.ct || res.encryptedMappings.ciphertext)) {
        rawPayloadStr = JSON.stringify({
          iv: res.encryptedMappings.iv,
          ciphertext: res.encryptedMappings.ct || res.encryptedMappings.ciphertext,
        });
        localStorage.setItem(LOCAL_STORAGE_KEY, rawPayloadStr);
      }
    } catch {
      // Ignore network errors or unauthenticated state
    }
  }

  if (!rawPayloadStr) {
    return {};
  }

  try {
    const payload = JSON.parse(rawPayloadStr);
    const decrypted = await decryptJSON<Record<string, BankColumnMapping>>(
      {
        iv: payload.iv,
        ciphertext: payload.ciphertext || payload.ct,
      },
      dataKey
    );
    return decrypted || {};
  } catch (err) {
    console.warn("Failed to decrypt bank mappings with current key:", err);
    return {};
  }
}

/**
 * Retrieves the saved mapping for a specific bank, decrypted with dataKey.
 */
export async function getBankMapping(
  bank: string,
  dataKey: CryptoKey
): Promise<BankColumnMapping | null> {
  const normalized = bank.trim().toUpperCase();
  const all = await getAllBankMappings(dataKey);
  return all[normalized] || null;
}

/**
 * Saves or updates a bank column mapping, encrypting it with the user's dataKey.
 */
export async function saveBankMapping(
  bank: string,
  mapping: BankColumnMapping,
  dataKey: CryptoKey
): Promise<void> {
  const normalized = bank.trim().toUpperCase();
  const current = await getAllBankMappings(dataKey);
  current[normalized] = {
    ...mapping,
    bank: normalized,
  };

  const encrypted = await encryptJSON(current, dataKey);
  const payloadToStore = {
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };

  // 1. Save locally
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payloadToStore));

  // 2. Sync to server in zero-knowledge encrypted form
  try {
    await apiFetch("/auth/mappings", {
      method: "PUT",
      body: JSON.stringify({
        encryptedMappings: {
          iv: encrypted.iv,
          ct: encrypted.ciphertext,
        },
      }),
    });
  } catch (err) {
    console.warn("Could not sync encrypted mappings to server:", err);
  }
}
