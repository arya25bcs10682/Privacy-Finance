/**
 * Unified API client helper with Bearer token authentication.
 *
 * In-memory token is mirrored to sessionStorage so a page refresh keeps the session.
 * Never stores secret keys, derived keys, or decrypted data - only the JWT.
 */

const API_BASE = import.meta.env.PROD
  ? "/api"
  : import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const TOKEN_STORAGE_KEY = "pf_jwt_token";
let inMemoryToken: string | null = null;

// Initialize in-memory token from sessionStorage if present
try {
  if (typeof window !== "undefined" && window.sessionStorage) {
    inMemoryToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }
} catch {
  // Ignore sessionStorage access errors
}

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        inMemoryToken = stored;
        return stored;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      if (token) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  // Add Authorization: Bearer <token> header to every request if token is present
  const token = getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Ensure no request depends on credentials: "include"
  const { credentials: _credentials, ...fetchOptions } = options as RequestInit & { credentials?: RequestCredentials };

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    // On a 401 response: clear the token and go to the login screen
    if (response.status === 401) {
      clearAuthToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
    }

    let errorMsg = `Request failed with status ${response.status}`;
    let data: unknown = undefined;
    try {
      data = await response.json();
      if (data && typeof data === "object") {
        const d = data as { error?: string; message?: string };
        if (d.error) {
          errorMsg = d.error;
        } else if (d.message) {
          errorMsg = d.message;
        }
      }
    } catch {
      // Body not JSON
    }
    throw new ApiError(response.status, errorMsg, data);
  }

  // Handle empty or 204 response
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
