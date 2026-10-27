import { encryptJSON, decryptJSON } from "../crypto";
import { apiFetch } from "../api";
import type { CategorizationRule, UserRulesAndOverrides } from "../transactions/categorizer";

const LOCAL_STORAGE_RULES_KEY = "pf_encrypted_user_rules";

export interface EncryptedRulesPayload {
  iv: string;
  ct: string;
  ciphertext?: string;
}

/**
 * Loads user categorization rules and manual transaction overrides,
 * decrypted in browser memory using the user's master AES-GCM dataKey.
 */
export async function loadRulesAndOverrides(
  dataKey: CryptoKey
): Promise<UserRulesAndOverrides> {
  const empty: UserRulesAndOverrides = { rules: [], overrides: {} };

  // 1. Try local storage first
  let rawPayloadStr = localStorage.getItem(LOCAL_STORAGE_RULES_KEY);

  // 2. Fall back to server if not present in local storage
  if (!rawPayloadStr) {
    try {
      const res = await apiFetch<{ encryptedRules: EncryptedRulesPayload | null }>("/auth/rules");
      if (
        res.encryptedRules &&
        res.encryptedRules.iv &&
        (res.encryptedRules.ct || res.encryptedRules.ciphertext)
      ) {
        rawPayloadStr = JSON.stringify({
          iv: res.encryptedRules.iv,
          ciphertext: res.encryptedRules.ct || res.encryptedRules.ciphertext,
        });
        localStorage.setItem(LOCAL_STORAGE_RULES_KEY, rawPayloadStr);
      }
    } catch {
      // Ignore network errors or unauthenticated state
    }
  }

  if (!rawPayloadStr) {
    return empty;
  }

  try {
    const payload = JSON.parse(rawPayloadStr);
    const decrypted = await decryptJSON<UserRulesAndOverrides>(
      {
        iv: payload.iv,
        ciphertext: payload.ciphertext || payload.ct,
      },
      dataKey
    );
    return {
      rules: decrypted.rules || [],
      overrides: decrypted.overrides || {},
    };
  } catch (err) {
    console.warn("Failed to decrypt user rules with current dataKey:", err);
    return empty;
  }
}

/**
 * Saves user categorization rules and manual transaction overrides,
 * encrypting them with AES-GCM 256 before persisting to disk/server.
 */
export async function saveRulesAndOverrides(
  data: UserRulesAndOverrides,
  dataKey: CryptoKey
): Promise<void> {
  const encrypted = await encryptJSON(data, dataKey);
  const payloadToStore = {
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };

  // 1. Save in local storage
  localStorage.setItem(LOCAL_STORAGE_RULES_KEY, JSON.stringify(payloadToStore));

  // 2. Sync to server in zero-knowledge encrypted form
  try {
    await apiFetch("/auth/rules", {
      method: "PUT",
      body: JSON.stringify({
        encryptedRules: {
          iv: encrypted.iv,
          ct: encrypted.ciphertext,
        },
      }),
    });
  } catch (err) {
    console.warn("Could not sync encrypted rules to server:", err);
  }
}

/**
 * Adds or updates a user-defined categorization rule (e.g. merchant pattern -> category).
 */
export async function addOrUpdateRule(
  rule: CategorizationRule,
  dataKey: CryptoKey
): Promise<UserRulesAndOverrides> {
  const current = await loadRulesAndOverrides(dataKey);
  const existingIdx = current.rules.findIndex((r) => r.id === rule.id);

  if (existingIdx >= 0) {
    current.rules[existingIdx] = rule;
  } else {
    current.rules.push(rule);
  }

  await saveRulesAndOverrides(current, dataKey);
  return current;
}

/**
 * Removes a custom categorization rule by ID.
 */
export async function removeRule(
  ruleId: string,
  dataKey: CryptoKey
): Promise<UserRulesAndOverrides> {
  const current = await loadRulesAndOverrides(dataKey);
  current.rules = current.rules.filter((r) => r.id !== ruleId);
  await saveRulesAndOverrides(current, dataKey);
  return current;
}

/**
 * Sets a manual category override for a specific transaction (by txHash or txId).
 */
export async function setTransactionOverride(
  txIdentifier: string,
  category: string,
  dataKey: CryptoKey
): Promise<UserRulesAndOverrides> {
  const current = await loadRulesAndOverrides(dataKey);
  current.overrides[txIdentifier] = category;
  await saveRulesAndOverrides(current, dataKey);
  return current;
}

/**
 * Clears a manual category override for a specific transaction.
 */
export async function clearTransactionOverride(
  txIdentifier: string,
  dataKey: CryptoKey
): Promise<UserRulesAndOverrides> {
  const current = await loadRulesAndOverrides(dataKey);
  delete current.overrides[txIdentifier];
  await saveRulesAndOverrides(current, dataKey);
  return current;
}
