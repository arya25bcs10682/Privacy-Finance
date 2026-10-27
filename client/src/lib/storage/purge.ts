/**
 * Wipes all encrypted cache items from localStorage.
 * Used during vault lock, user logout, or session termination to ensure
 * zero residual ciphertext or metadata remains on shared devices.
 */
export function purgeAllEncryptedStorage(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("pf_encrypted_") || key.startsWith("pf_"))) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn("Could not purge encrypted local storage:", err);
  }
}
