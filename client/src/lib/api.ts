/**
 * API client helper with automatic credential forwarding for httpOnly JWT cookies.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

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

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // Essential for httpOnly cookies
  });

  if (!response.ok) {
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
