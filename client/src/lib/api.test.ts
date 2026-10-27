import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  apiFetch,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  ApiError,
} from "./api";

describe("Unified API Client Helper (api.ts)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAuthToken();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("mirrors token between memory and sessionStorage", () => {
    expect(getAuthToken()).toBeNull();

    setAuthToken("jwt-token-123");
    expect(getAuthToken()).toBe("jwt-token-123");
    expect(sessionStorage.getItem("pf_jwt_token")).toBe("jwt-token-123");

    clearAuthToken();
    expect(getAuthToken()).toBeNull();
    expect(sessionStorage.getItem("pf_jwt_token")).toBeNull();
  });

  it("retrieves token from sessionStorage if present (e.g. on page refresh)", () => {
    sessionStorage.setItem("pf_jwt_token", "restored-token-456");
    expect(getAuthToken()).toBe("restored-token-456");
  });

  it("automatically attaches 'Authorization: Bearer <token>' to requests", async () => {
    setAuthToken("my-secure-jwt");

    let capturedHeaders: Headers | undefined;
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedOptions = options;
      capturedHeaders = options.headers as Headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const res = await apiFetch<{ ok: boolean }>("/test-endpoint");
    expect(res.ok).toBe(true);
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer my-secure-jwt");
    // Verify credentials: "include" is NOT set
    expect((capturedOptions as Record<string, unknown>)?.credentials).not.toBe("include");
  });

  it("on 401 response: clears token and dispatches auth:unauthorized event", async () => {
    setAuthToken("expiring-token");
    expect(getAuthToken()).toBe("expiring-token");

    const eventSpy = vi.fn();
    window.addEventListener("auth:unauthorized", eventSpy);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(apiFetch("/protected-resource")).rejects.toThrow(ApiError);

    // Verify token was cleared
    expect(getAuthToken()).toBeNull();
    expect(sessionStorage.getItem("pf_jwt_token")).toBeNull();

    // Verify unauthorized event was dispatched
    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener("auth:unauthorized", eventSpy);
  });
});
