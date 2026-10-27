import { describe, it, expect, beforeEach } from "vitest";
import { purgeAllEncryptedStorage } from "./purge";

describe("Unified Storage Purge (purgeAllEncryptedStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("wipes all encrypted cache items from localStorage on lock/logout", () => {
    // Simulate active encrypted local storage keys
    localStorage.setItem("pf_encrypted_user_rules", JSON.stringify({ iv: "1", ct: "2" }));
    localStorage.setItem("pf_encrypted_bills", JSON.stringify([{ id: "1" }]));
    localStorage.setItem("pf_encrypted_budget_2026-03", JSON.stringify({ iv: "3", ct: "4" }));
    localStorage.setItem("pf_encrypted_holdings", JSON.stringify([{ symbol: "RELIANCE.NS" }]));
    localStorage.setItem("pf_encrypted_bank_mappings", JSON.stringify({ HDFC: {} }));
    localStorage.setItem("other_unrelated_setting", "theme-dark");

    expect(localStorage.getItem("pf_encrypted_user_rules")).not.toBeNull();
    expect(localStorage.getItem("pf_encrypted_bills")).not.toBeNull();
    expect(localStorage.getItem("pf_encrypted_budget_2026-03")).not.toBeNull();
    expect(localStorage.getItem("pf_encrypted_holdings")).not.toBeNull();

    // Trigger purge
    purgeAllEncryptedStorage();

    // Verify all pf_* encrypted caches are eradicated
    expect(localStorage.getItem("pf_encrypted_user_rules")).toBeNull();
    expect(localStorage.getItem("pf_encrypted_bills")).toBeNull();
    expect(localStorage.getItem("pf_encrypted_budget_2026-03")).toBeNull();
    expect(localStorage.getItem("pf_encrypted_holdings")).toBeNull();
    expect(localStorage.getItem("pf_encrypted_bank_mappings")).toBeNull();

    // Non-pf keys remain unaffected
    expect(localStorage.getItem("other_unrelated_setting")).toBe("theme-dark");
  });
});
