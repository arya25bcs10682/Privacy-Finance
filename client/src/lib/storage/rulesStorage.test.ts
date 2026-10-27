import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadRulesAndOverrides,
  saveRulesAndOverrides,
  addOrUpdateRule,
  removeRule,
  setTransactionOverride,
  clearTransactionOverride,
} from "./rulesStorage";
import { generateDataKey } from "../crypto";
import * as api from "../api";

describe("Encrypted Rules Storage (rulesStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves and loads user rules and manual overrides encrypted with AES-GCM 256", async () => {
    const dataKey = await generateDataKey();

    const sampleRules = [
      { id: "r1", pattern: "SWIGGY", category: "Food & Dining" },
      { id: "r2", pattern: "NETFLIX", category: "Entertainment" },
    ];
    const sampleOverrides = {
      "tx-hash-1": "Travel & Commute",
    };

    const putSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({ ok: true });

    await saveRulesAndOverrides({ rules: sampleRules, overrides: sampleOverrides }, dataKey);

    // 1. Verify saved in localStorage in encrypted format ({ iv, ciphertext })
    const storedRaw = localStorage.getItem("pf_encrypted_user_rules");
    expect(storedRaw).not.toBeNull();
    const parsed = JSON.parse(storedRaw!);
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("ciphertext");
    // Plaintext strings must NOT be visible in raw storage
    expect(storedRaw).not.toContain("SWIGGY");
    expect(storedRaw).not.toContain("Travel & Commute");

    // 2. Verify synced to server encrypted
    expect(putSpy).toHaveBeenCalledWith("/auth/rules", expect.objectContaining({ method: "PUT" }));

    // 3. Decrypt and load back in memory
    const loaded = await loadRulesAndOverrides(dataKey);
    expect(loaded.rules).toHaveLength(2);
    expect(loaded.rules[0].pattern).toBe("SWIGGY");
    expect(loaded.overrides["tx-hash-1"]).toBe("Travel & Commute");
  });

  it("fails to decrypt with wrong key and returns empty fallback", async () => {
    const correctKey = await generateDataKey();
    const wrongKey = await generateDataKey();

    vi.spyOn(api, "apiFetch").mockResolvedValue({ ok: true });

    await saveRulesAndOverrides(
      {
        rules: [{ id: "r1", pattern: "SECRET", category: "Investments" }],
        overrides: {},
      },
      correctKey
    );

    // Loading with wrong key should fail decryption safely
    const loaded = await loadRulesAndOverrides(wrongKey);
    expect(loaded.rules).toEqual([]);
    expect(loaded.overrides).toEqual({});
  });

  it("adds, updates, and removes custom rules", async () => {
    const dataKey = await generateDataKey();
    vi.spyOn(api, "apiFetch").mockResolvedValue({ ok: true });

    // Add rule
    let current = await addOrUpdateRule(
      { id: "r1", pattern: "BLINKIT", category: "Shopping & Groceries" },
      dataKey
    );
    expect(current.rules).toHaveLength(1);
    expect(current.rules[0].pattern).toBe("BLINKIT");

    // Update rule
    current = await addOrUpdateRule(
      { id: "r1", pattern: "BLINKIT", category: "Food & Dining" },
      dataKey
    );
    expect(current.rules).toHaveLength(1);
    expect(current.rules[0].category).toBe("Food & Dining");

    // Remove rule
    current = await removeRule("r1", dataKey);
    expect(current.rules).toHaveLength(0);
  });

  it("sets and clears manual transaction overrides", async () => {
    const dataKey = await generateDataKey();
    vi.spyOn(api, "apiFetch").mockResolvedValue({ ok: true });

    // Set override
    let current = await setTransactionOverride("tx-123", "Health & Wellness", dataKey);
    expect(current.overrides["tx-123"]).toBe("Health & Wellness");

    // Clear override
    current = await clearTransactionOverride("tx-123", dataKey);
    expect(current.overrides["tx-123"]).toBeUndefined();
  });
});
