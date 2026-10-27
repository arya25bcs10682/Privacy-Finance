/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  deriveKeyFromSecret,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  generateRecoveryCode,
  unwrapDataKeyFromRecoveryCode,
  arrayBufferToBase64,
  type WrappedKeyResult,
} from "@/lib/crypto";
import { apiFetch, setAuthToken, clearAuthToken, getAuthToken } from "@/lib/api";
import { purgeAllEncryptedStorage } from "@/lib/storage/purge";

export interface UserSession {
  id: string;
  email: string;
}

export interface AuthResponse {
  token?: string;
  user: UserSession;
  keySalt: string;
  wrappedDataKey: WrappedKeyResult;
  wrappedDataKeyByRecovery: WrappedKeyResult | string;
}

export interface PreparedSignupData {
  email: string;
  passwordHashPlaceHolder?: string;
  keySalt: string;
  wrappedDataKey: WrappedKeyResult;
  wrappedDataKeyByRecovery: WrappedKeyResult | string;
  recoveryCode: string;
  dataKey: CryptoKey;
}

export interface KeyContextType {
  user: UserSession | null;
  dataKey: CryptoKey | null;
  keySalt: string | null;
  wrappedDataKey: WrappedKeyResult | null;
  wrappedDataKeyByRecovery: WrappedKeyResult | string | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  isLoading: boolean;
  idleTimeoutRemainingMs: number;
  login: (email: string, password: string) => Promise<{ requiresSecretKey: boolean }>;
  prepareSignup: (email: string, password: string, secretKey: string) => Promise<string>;
  completeSignup: (email: string, password: string) => Promise<void>;
  unlock: (secretKey: string) => Promise<void>;
  unlockWithRecovery: (recoveryCode: string) => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;
  resetIdleTimer: () => void;
}

export const KeyContext = createContext<KeyContextType | undefined>(undefined);

// 15 minutes of inactivity before locking and wiping memory keys
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function KeyProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [keySalt, setKeySalt] = useState<string | null>(null);
  const [wrappedDataKey, setWrappedDataKey] = useState<WrappedKeyResult | null>(null);
  const [wrappedDataKeyByRecovery, setWrappedDataKeyByRecovery] = useState<
    WrappedKeyResult | string | null
  >(null);

  // In-memory master encryption key (STRICT: never written to storage)
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null);

  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [idleTimeoutRemainingMs, setIdleTimeoutRemainingMs] = useState<number>(IDLE_TIMEOUT_MS);

  // Transient signup preparation state (in memory only, prior to confirmation)
  const pendingSignupRef = useRef<PreparedSignupData | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Lock the application and wipe master keys from memory.
   */
  const lock = useCallback(() => {
    // Zero-knowledge rule: wipe key from memory immediately upon lock
    setDataKey(null);
    setIsLocked(true);
    purgeAllEncryptedStorage();
  }, []);

  /**
   * Reset idle activity timestamp
   */
  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleTimeoutRemainingMs(IDLE_TIMEOUT_MS);
  }, []);

  /**
   * Logout user, clear session token, and wipe keys from memory.
   */
  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Logout even if network fails
    } finally {
      clearAuthToken();
      setDataKey(null);
      setUser(null);
      setKeySalt(null);
      setWrappedDataKey(null);
      setWrappedDataKeyByRecovery(null);
      setIsLocked(false);
      pendingSignupRef.current = null;
      purgeAllEncryptedStorage();
    }
  }, []);

  /**
   * Handle global 401 unauthorized event by clearing session state
   */
  useEffect(() => {
    const handleUnauthorized = () => {
      setDataKey(null);
      setUser(null);
      setKeySalt(null);
      setWrappedDataKey(null);
      setWrappedDataKeyByRecovery(null);
      setIsLocked(false);
      pendingSignupRef.current = null;
      purgeAllEncryptedStorage();
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);

  /**
   * Check initial session on app mount using stored token
   */
  useEffect(() => {
    let isMounted = true;
    async function checkSession() {
      const token = getAuthToken();
      if (!token) {
        if (!isMounted) return;
        setUser(null);
        setIsLocked(false);
        setIsLoading(false);
        return;
      }

      try {
        const data = await apiFetch<AuthResponse>("/auth/me");
        if (!isMounted) return;
        setUser(data.user);
        setKeySalt(data.keySalt);
        setWrappedDataKey(data.wrappedDataKey);
        setWrappedDataKeyByRecovery(data.wrappedDataKeyByRecovery);

        // Session exists via token, but master dataKey is not yet in memory.
        // Prompt user for Secret Key to unlock.
        setIsLocked(true);
      } catch {
        // Token invalid or expired
        if (!isMounted) return;
        clearAuthToken();
        setUser(null);
        setIsLocked(false);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    checkSession();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * 15-minute idle detection loop and user activity listeners
   */
  useEffect(() => {
    if (!user || isLocked || !dataKey) {
      if (idleTimerRef.current) {
        clearInterval(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    // Reset last activity on unlock/login
    lastActivityRef.current = Date.now();

    const handleUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];
    events.forEach((evt) => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Check idle interval every 5 seconds
    idleTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - elapsed);
      setIdleTimeoutRemainingMs(remaining);

      if (elapsed >= IDLE_TIMEOUT_MS) {
        lock();
      }
    }, 5000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleUserActivity));
      if (idleTimerRef.current) {
        clearInterval(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [user, isLocked, dataKey, lock]);

  /**
   * Client login flow:
   * Step 1: Submit email + password. Server validates password and returns salt + wrapped keys.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<{ requiresSecretKey: boolean }> => {
      setIsLoading(true);
      try {
        const data = await apiFetch<AuthResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });

        if (data.token) {
          setAuthToken(data.token);
        }

        setUser(data.user);
        setKeySalt(data.keySalt);
        setWrappedDataKey(data.wrappedDataKey);
        setWrappedDataKeyByRecovery(data.wrappedDataKeyByRecovery);

        // Require Secret Key to unwrap dataKey in memory
        setIsLocked(true);
        setDataKey(null);
        resetIdleTimer();

        return { requiresSecretKey: true };
      } finally {
        setIsLoading(false);
      }
    },
    [resetIdleTimer]
  );

  /**
   * Client signup flow - Stage 1:
   * Generates master data key, salt, wraps with secret-derived key & recovery code.
   * Returns recovery code for mandatory one-time display.
   */
  const prepareSignup = useCallback(
    async (email: string, _password: string, secretKey: string): Promise<string> => {
      if (!secretKey || secretKey.length < 8) {
        throw new Error("Secret Key must be at least 8 characters.");
      }

      // Generate fresh random 16-byte salt
      const saltBuffer = window.crypto.getRandomValues(new Uint8Array(16));
      const saltBase64 = arrayBufferToBase64(saltBuffer);

      // Generate random AES-GCM 256 master data key
      const masterKey = await generateDataKey();

      // Derive wrapping key using PBKDF2-SHA256 (600,000 iterations)
      const secretWrappingKey = await deriveKeyFromSecret(secretKey, saltBase64, 600_000, "AES-KW");

      // Wrap data key with secret wrapping key
      const wrappedWithSecret = await wrapDataKey(masterKey, secretWrappingKey);

      // Generate human-readable recovery code from dataKey
      const recoveryCode = await generateRecoveryCode(masterKey);

      // Also derive wrapping key from recovery code
      const recoveryWrappingKey = await deriveKeyFromSecret(
        recoveryCode,
        saltBase64,
        10_000,
        "AES-KW"
      );
      const wrappedWithRecovery = await wrapDataKey(masterKey, recoveryWrappingKey);

      // Stash in memory until mandatory confirmation is signed
      pendingSignupRef.current = {
        email,
        keySalt: saltBase64,
        wrappedDataKey: wrappedWithSecret,
        wrappedDataKeyByRecovery: wrappedWithRecovery,
        recoveryCode,
        dataKey: masterKey,
      };

      return recoveryCode;
    },
    []
  );

  /**
   * Client signup flow - Stage 2:
   * Transmits ONLY email, password, salt, and wrapped keys to server.
   * Server NEVER receives secretKey or recoveryCode.
   */
  const completeSignup = useCallback(
    async (email: string, password: string): Promise<void> => {
      const pending = pendingSignupRef.current;
      if (!pending || pending.email !== email) {
        throw new Error("No pending signup session found. Please restart registration.");
      }

      setIsLoading(true);
      try {
        const payload = {
          email,
          password,
          keySalt: pending.keySalt,
          wrappedDataKey: pending.wrappedDataKey,
          wrappedDataKeyByRecovery: pending.wrappedDataKeyByRecovery,
        };

        const data = await apiFetch<AuthResponse>("/auth/signup", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        if (data.token) {
          setAuthToken(data.token);
        }

        setUser(data.user);
        setKeySalt(data.keySalt);
        setWrappedDataKey(data.wrappedDataKey);
        setWrappedDataKeyByRecovery(data.wrappedDataKeyByRecovery);

        // Keep master key in memory
        setDataKey(pending.dataKey);
        setIsLocked(false);
        resetIdleTimer();

        // Clear transient pending ref
        pendingSignupRef.current = null;
      } finally {
        setIsLoading(false);
      }
    },
    [resetIdleTimer]
  );

  /**
   * Unlock app using the Secret Key. Unwraps data key in memory.
   */
  const unlock = useCallback(
    async (secretKey: string): Promise<void> => {
      if (!keySalt || !wrappedDataKey) {
        throw new Error("Key metadata missing from session.");
      }

      setIsLoading(true);
      try {
        const wrappingKey = await deriveKeyFromSecret(secretKey, keySalt, 600_000, "AES-KW");
        const unwrapped = await unwrapDataKey(wrappedDataKey, wrappingKey);

        setDataKey(unwrapped);
        setIsLocked(false);
        resetIdleTimer();
      } catch {
        throw new Error("Incorrect Secret Key. Unable to decrypt master data key.");
      } finally {
        setIsLoading(false);
      }
    },
    [keySalt, wrappedDataKey, resetIdleTimer]
  );

  /**
   * Unlock app using the Recovery Code. Unwraps data key in memory.
   */
  const unlockWithRecovery = useCallback(
    async (recoveryCode: string): Promise<void> => {
      setIsLoading(true);
      try {
        let unwrapped: CryptoKey | null = null;

        // Try direct recovery unwrap
        try {
          unwrapped = await unwrapDataKeyFromRecoveryCode(recoveryCode);
        } catch {
          // Fallback to wrappedDataKeyByRecovery with salt
          if (keySalt && wrappedDataKeyByRecovery) {
            const recoveryWrappingKey = await deriveKeyFromSecret(
              recoveryCode,
              keySalt,
              10_000,
              "AES-KW"
            );
            unwrapped = await unwrapDataKey(wrappedDataKeyByRecovery, recoveryWrappingKey);
          }
        }

        if (!unwrapped) {
          throw new Error("Recovery failed.");
        }

        setDataKey(unwrapped);
        setIsLocked(false);
        resetIdleTimer();
      } catch {
        throw new Error("Invalid Recovery Code. Unable to recover master key.");
      } finally {
        setIsLoading(false);
      }
    },
    [keySalt, wrappedDataKeyByRecovery, resetIdleTimer]
  );

  return (
    <KeyContext.Provider
      value={{
        user,
        dataKey,
        keySalt,
        wrappedDataKey,
        wrappedDataKeyByRecovery,
        isAuthenticated: !!user,
        isLocked,
        isLoading,
        idleTimeoutRemainingMs,
        login,
        prepareSignup,
        completeSignup,
        unlock,
        unlockWithRecovery,
        lock,
        logout,
        resetIdleTimer,
      }}
    >
      {children}
    </KeyContext.Provider>
  );
}

export function useKeyContext(): KeyContextType {
  const context = useContext(KeyContext);
  if (!context) {
    throw new Error("useKeyContext must be used within a KeyProvider");
  }
  return context;
}
