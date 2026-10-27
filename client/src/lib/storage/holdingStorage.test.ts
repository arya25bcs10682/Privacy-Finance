import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadEncryptedHoldings,
  saveEncryptedHolding,
  deleteEncryptedHolding,
  purgeEncryptedHoldings,
} from "./holdingStorage";
import { generateDataKey } from "../crypto";
import * as api from "../api";
import type { HoldingItem } from "../holdings/types";

describe("Encrypted Holding Storage (holdingStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("encrypts holding with AES-GCM 256 and never transmits plaintext to server", async () => {
    const dataKey = await generateDataKey();

    const sampleHolding: Omit<HoldingItem, "id"> = {
      symbol: "INFY.NS",
      name: "Infosys Limited",
      units: 45,
      avgPrice: 1520.5,
      assetType: "stock",
      currency: "INR",
      notes: "Long-term investment portfolio",
    };

    const postSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({
      holding: { _id: "server-holding-doc-123" },
    });

    const saved = await saveEncryptedHolding(sampleHolding, dataKey);
    expect(saved.id).toBe("server-holding-doc-123");

    // 1. Verify localStorage contains zero plaintext strings
    const rawStored = localStorage.getItem("pf_encrypted_holdings");
    expect(rawStored).not.toBeNull();
    expect(rawStored).not.toContain("Infosys Limited");
    expect(rawStored).not.toContain("Long-term investment portfolio");
    expect(rawStored).not.toContain("1520.5");

    const parsed = JSON.parse(rawStored!);
    expect(parsed[0].encryptedPayload).toHaveProperty("iv");
    expect(parsed[0].encryptedPayload).toHaveProperty("ciphertext");

    // 2. Verify server payload only has encryptedPayload and coarse assetClass
    expect(postSpy).toHaveBeenCalledWith(
      "/holdings",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"encryptedPayload"'),
      })
    );
    const sentBody = JSON.parse(postSpy.mock.calls[0][1]?.body as string);
    expect(sentBody).not.toHaveProperty("name");
    expect(sentBody).not.toHaveProperty("units");
    expect(sentBody).not.toHaveProperty("avgPrice");

    // 3. Decrypt and verify in-memory loading
    const loaded = await loadEncryptedHoldings(dataKey);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].symbol).toBe("INFY.NS");
    expect(loaded[0].name).toBe("Infosys Limited");
    expect(loaded[0].units).toBe(45);
    expect(loaded[0].avgPrice).toBe(1520.5);
    expect(loaded[0].notes).toBe("Long-term investment portfolio");
  });

  it("deletes encrypted holding from server and localStorage", async () => {
    const deleteSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({ message: "Holding deleted" });

    localStorage.setItem(
      "pf_encrypted_holdings",
      JSON.stringify([{ _id: "holding-xyz", encryptedPayload: { iv: "iv", ct: "ct" } }])
    );

    await deleteEncryptedHolding("holding-xyz");

    expect(deleteSpy).toHaveBeenCalledWith("/holdings/holding-xyz", { method: "DELETE" });
    const raw = localStorage.getItem("pf_encrypted_holdings");
    expect(JSON.parse(raw!)).toEqual([]);
  });

  it("purges holdings from local storage on vault lock", () => {
    localStorage.setItem("pf_encrypted_holdings", JSON.stringify([{ _id: "doc-1" }]));
    purgeEncryptedHoldings();
    expect(localStorage.getItem("pf_encrypted_holdings")).toBeNull();
  });
});
