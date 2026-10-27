import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { KeyProvider, useKeyContext } from "./KeyContext";
import * as api from "@/lib/api";

describe("KeyContext Provider (Zero-Knowledge In-Memory Store)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeyProvider>{children}</KeyProvider>
  );

  it("initializes with null dataKey and not authenticated when no cookie exists", async () => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(new Error("Unauthorized"));

    const { result } = renderHook(() => useKeyContext(), { wrapper });

    await act(async () => {
      // allow initial session check
    });

    expect(result.current.user).toBeNull();
    expect(result.current.dataKey).toBeNull();
    expect(result.current.isLocked).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("prepares signup, displays recovery code, and completes registration without sending secretKey", async () => {
    vi.spyOn(api, "apiFetch").mockImplementation(async (endpoint, options) => {
      if (endpoint === "/auth/me") throw new Error("401");
      if (endpoint === "/auth/signup") {
        const body = JSON.parse(options?.body as string);

        // STRICT ASSERTION: Server must NEVER receive the secret key or recovery code
        expect(body).not.toHaveProperty("secretKey");
        expect(body).not.toHaveProperty("recoveryCode");
        expect(body).toHaveProperty("keySalt");
        expect(body).toHaveProperty("wrappedDataKey");
        expect(body).toHaveProperty("wrappedDataKeyByRecovery");

        return {
          user: { id: "user-123", email: body.email },
          keySalt: body.keySalt,
          wrappedDataKey: body.wrappedDataKey,
          wrappedDataKeyByRecovery: body.wrappedDataKeyByRecovery,
        };
      }
      return {};
    });

    const { result } = renderHook(() => useKeyContext(), { wrapper });

    let recoveryCode = "";
    await act(async () => {
      recoveryCode = await result.current.prepareSignup(
        "alice@example.com",
        "loginPassword123!",
        "masterSecretPassphrase2026!"
      );
    });

    expect(recoveryCode).toMatch(/^RC-/);

    // Complete signup after confirmation
    await act(async () => {
      await result.current.completeSignup("alice@example.com", "loginPassword123!");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLocked).toBe(false);
    expect(result.current.dataKey).not.toBeNull();
  });

  it("wipes dataKey from memory immediately on lock()", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue({
      user: { id: "user-123", email: "alice@example.com" },
      keySalt: "sample-salt",
      wrappedDataKey: { ciphertext: "ciphertext" },
      wrappedDataKeyByRecovery: { ciphertext: "recovery-ciphertext" },
    });

    const { result } = renderHook(() => useKeyContext(), { wrapper });

    // Simulate unlocked state
    await act(async () => {
      await result.current.prepareSignup(
        "alice@example.com",
        "loginPassword123!",
        "secretPassphrase!"
      );
      await result.current.completeSignup("alice@example.com", "loginPassword123!");
    });

    expect(result.current.dataKey).not.toBeNull();

    // Lock app
    act(() => {
      result.current.lock();
    });

    // Zero-knowledge assertion: key MUST be null in memory
    expect(result.current.dataKey).toBeNull();
    expect(result.current.isLocked).toBe(true);
  });

  it("wipes dataKey from memory on logout()", async () => {
    const logoutSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({});

    const { result } = renderHook(() => useKeyContext(), { wrapper });

    await act(async () => {
      await result.current.prepareSignup(
        "alice@example.com",
        "loginPassword123!",
        "secretPassphrase!"
      );
      await result.current.completeSignup("alice@example.com", "loginPassword123!");
    });

    expect(result.current.dataKey).not.toBeNull();

    await act(async () => {
      await result.current.logout();
    });

    expect(logoutSpy).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
    expect(result.current.dataKey).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("locks vault and wipes key after 15 minutes of idle", async () => {
    vi.useFakeTimers();

    vi.spyOn(api, "apiFetch").mockResolvedValue({
      user: { id: "user-123", email: "alice@example.com" },
      keySalt: "sample-salt",
      wrappedDataKey: { ciphertext: "ciphertext" },
      wrappedDataKeyByRecovery: { ciphertext: "recovery-ciphertext" },
    });

    const { result } = renderHook(() => useKeyContext(), { wrapper });

    await act(async () => {
      await result.current.prepareSignup(
        "alice@example.com",
        "loginPassword123!",
        "secretPassphrase!"
      );
      await result.current.completeSignup("alice@example.com", "loginPassword123!");
    });

    expect(result.current.dataKey).not.toBeNull();
    expect(result.current.isLocked).toBe(false);

    // Advance timer by 15 minutes + 5 seconds
    act(() => {
      vi.advanceTimersByTime(15 * 60 * 1000 + 5000);
    });

    // Master key wiped and app locked
    expect(result.current.dataKey).toBeNull();
    expect(result.current.isLocked).toBe(true);
  });
});
