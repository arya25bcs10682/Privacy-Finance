/**
 * Privacy-First Zero-Knowledge Web Crypto Library
 * Built exclusively with window.crypto.subtle and window.crypto.getRandomValues.
 * Strictly adheres to project security rules:
 * - AES-GCM 256 encryption client-side
 * - Fresh random 12-byte IV per encryption (never reused)
 * - Derived keys in-memory only, secrets never logged
 */

// Types & Interfaces
export interface EncryptedData {
  iv: string; // base64 encoded 12-byte IV
  ciphertext: string; // base64 encoded ciphertext + auth tag
}

export interface EncryptedBlobResult {
  iv: string; // base64 encoded 12-byte IV
  ciphertext: Blob;
}

export interface WrappedKeyResult {
  ciphertext: string; // base64 encoded wrapped key
  iv?: string; // base64 encoded IV (present if AES-GCM wrapping is used)
}

export interface TxHashFields {
  date?: string | Date;
  Date?: string | Date;
  amount?: number | string;
  Amount?: number | string;
  type?: string;
  Type?: string;
  cleanedDescription?: string;
  CleanedDescription?: string;
  runningBalance?: number | string;
  RunningBalance?: number | string;
}

// Crockford Base32 Alphabet (excludes ambiguous I, L, O)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Utility: Convert ArrayBuffer or Uint8Array to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Utility: Convert base64 string to Uint8Array
 */
export function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Utility: Convert ArrayBuffer to Hex string
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encode raw bytes to Crockford Base32 string
 */
function encodeCrockfordBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode Crockford Base32 string to Uint8Array
 */
function decodeCrockfordBase32(str: string): Uint8Array {
  const normalized = str
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0123456789ABCDEFGHJKMNPQRSTVWXYZ]/g, "");

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const idx = CROCKFORD_ALPHABET.indexOf(normalized[i]);
    if (idx === -1) {
      throw new Error(`Invalid recovery code character: ${normalized[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Safely access Web Crypto subtle instance
 */
function getSubtle(): SubtleCrypto {
  const subtle = window.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (window.crypto.subtle) is not available.");
  }
  return subtle;
}

/**
 * 1. deriveKeyFromSecret(secret, salt)
 * PBKDF2-SHA256, 600,000 iterations, returns an AES-KW/AES-GCM wrapping key (non-extractable)
 *
 * @param secret - User passphrase or master secret string
 * @param salt - Salt (Uint8Array or string, at least 16 bytes recommended)
 * @param iterations - Iteration count (defaults to 600,000)
 * @param algorithm - Wrapping algorithm: "AES-KW" (default) or "AES-GCM"
 */
export async function deriveKeyFromSecret(
  secret: string,
  salt: Uint8Array | string,
  iterations: number = 600_000,
  algorithm: "AES-KW" | "AES-GCM" = "AES-KW"
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const secretBytes = enc.encode(secret);
  const saltBytes = typeof salt === "string" ? enc.encode(salt) : salt;

  const keyMaterial = await subtle.importKey(
    "raw",
    secretBytes as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: algorithm,
      length: 256,
    },
    false, // non-extractable wrapping key
    ["wrapKey", "unwrapKey"]
  );
}

/**
 * 2. generateDataKey()
 * Generates a random AES-GCM 256 master data key.
 * Extractable so it can be wrapped and exported for HKDF subkey derivation.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  const subtle = getSubtle();
  return subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable for wrapping / HKDF
    ["encrypt", "decrypt"]
  );
}

/**
 * 3. wrapDataKey(dataKey, wrappingKey) / unwrapDataKey(wrapped, wrappingKey)
 * Wraps the master data key using either AES-KW or AES-GCM wrapping key.
 */
export async function wrapDataKey(
  dataKey: CryptoKey,
  wrappingKey: CryptoKey
): Promise<WrappedKeyResult> {
  const subtle = getSubtle();
  const isGcm = wrappingKey.algorithm.name === "AES-GCM";
  let iv: Uint8Array | undefined;
  let wrapAlgorithm: AlgorithmIdentifier | AesGcmParams | "AES-KW";

  if (isGcm) {
    iv = window.crypto.getRandomValues(new Uint8Array(12));
    wrapAlgorithm = { name: "AES-GCM", iv: iv as unknown as BufferSource };
  } else {
    wrapAlgorithm = "AES-KW";
  }

  const wrappedBuffer = await subtle.wrapKey("raw", dataKey, wrappingKey, wrapAlgorithm);

  return {
    ciphertext: arrayBufferToBase64(wrappedBuffer),
    ...(iv ? { iv: arrayBufferToBase64(iv) } : {}),
  };
}

/**
 * Unwraps the wrapped master data key.
 * Can unwrap:
 * - WrappedKeyResult { ciphertext, iv }
 * - base64 string (either "iv:ciphertext" or single "ciphertext" for AES-KW)
 * - human-readable recovery code starting with "RC-"
 */
export async function unwrapDataKey(
  wrapped: WrappedKeyResult | string,
  wrappingKey?: CryptoKey
): Promise<CryptoKey> {
  // If passed a human-readable recovery code, unwrap directly
  if (typeof wrapped === "string" && wrapped.startsWith("RC-")) {
    return unwrapDataKeyFromRecoveryCode(wrapped);
  }

  if (!wrappingKey) {
    throw new Error("wrappingKey is required to unwrap data key");
  }

  const subtle = getSubtle();
  let ciphertextBase64: string;
  let ivBase64: string | undefined;

  if (typeof wrapped === "string") {
    if (wrapped.includes(":")) {
      const parts = wrapped.split(":");
      ivBase64 = parts[0];
      ciphertextBase64 = parts[1];
    } else {
      ciphertextBase64 = wrapped;
    }
  } else {
    ciphertextBase64 = wrapped.ciphertext;
    ivBase64 = wrapped.iv;
  }

  const ciphertextBytes = base64ToArrayBuffer(ciphertextBase64);
  const isGcm = wrappingKey.algorithm.name === "AES-GCM";

  let unwrapAlgorithm: AlgorithmIdentifier | AesGcmParams | "AES-KW";
  if (isGcm) {
    if (!ivBase64) {
      throw new Error("AES-GCM unwrap requires IV");
    }
    unwrapAlgorithm = {
      name: "AES-GCM",
      iv: base64ToArrayBuffer(ivBase64) as unknown as BufferSource,
    };
  } else {
    unwrapAlgorithm = "AES-KW";
  }

  return subtle.unwrapKey(
    "raw",
    ciphertextBytes as unknown as BufferSource,
    wrappingKey,
    unwrapAlgorithm,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * 4. encryptJSON(obj, dataKey) -> {iv, ciphertext} base64; decryptJSON
 * Uses AES-GCM 256 with fresh random 12-byte IV per encryption (Rule 5).
 */
export async function encryptJSON(obj: unknown, dataKey: CryptoKey): Promise<EncryptedData> {
  const subtle = getSubtle();
  const jsonStr = JSON.stringify(obj);
  const encoded = new TextEncoder().encode(jsonStr);

  // Fresh random 12-byte IV per encryption (Rule 5)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptedBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
    },
    dataKey,
    encoded as unknown as BufferSource
  );

  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(encryptedBuffer),
  };
}

/**
 * Decrypts {iv, ciphertext} and parses original JSON object.
 * Throws DOMException / OperationError if ciphertext or IV has been tampered with or key is invalid.
 */
export async function decryptJSON<T = unknown>(
  encrypted: EncryptedData,
  dataKey: CryptoKey
): Promise<T> {
  const subtle = getSubtle();
  const ivBytes = base64ToArrayBuffer(encrypted.iv);
  const ciphertextBytes = base64ToArrayBuffer(encrypted.ciphertext);

  const decryptedBuffer = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes as unknown as BufferSource,
    },
    dataKey,
    ciphertextBytes as unknown as BufferSource
  );

  const jsonStr = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonStr) as T;
}

/**
 * Utility: Extract ArrayBuffer from a Blob safely across environments
 */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 5. encryptBlob / decryptBlob for files
 * Encrypts a binary Blob using AES-GCM 256 with a fresh 12-byte IV.
 */
export async function encryptBlob(blob: Blob, dataKey: CryptoKey): Promise<EncryptedBlobResult> {
  const subtle = getSubtle();
  const arrayBuffer = await blobToArrayBuffer(blob);

  // Fresh random 12-byte IV per encryption
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptedBuffer = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
    },
    dataKey,
    arrayBuffer as unknown as BufferSource
  );

  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: new Blob([encryptedBuffer], { type: "application/octet-stream" }),
  };
}

/**
 * Decrypts a binary Blob using AES-GCM 256.
 * Accepts { iv, ciphertext } or a single Blob (with options.iv or prepended 12-byte IV).
 */
export async function decryptBlob(
  encrypted: EncryptedBlobResult | Blob,
  dataKey: CryptoKey,
  options?: { mimeType?: string; iv?: string }
): Promise<Blob> {
  const subtle = getSubtle();
  let ivBytes: Uint8Array;
  let ciphertextBuffer: ArrayBuffer;

  if ("iv" in encrypted && "ciphertext" in encrypted) {
    ivBytes = base64ToArrayBuffer(encrypted.iv);
    ciphertextBuffer = await blobToArrayBuffer(encrypted.ciphertext);
  } else if (encrypted instanceof Blob) {
    if (options?.iv) {
      ivBytes = base64ToArrayBuffer(options.iv);
      ciphertextBuffer = await blobToArrayBuffer(encrypted);
    } else {
      // Pre-pended 12-byte IV
      const buffer = await blobToArrayBuffer(encrypted);
      if (buffer.byteLength < 12) {
        throw new Error("Ciphertext too short to contain 12-byte IV");
      }
      ivBytes = new Uint8Array(buffer.slice(0, 12));
      ciphertextBuffer = buffer.slice(12);
    }
  } else {
    throw new Error("Invalid encrypted blob input format");
  }

  const decryptedBuffer = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes as unknown as BufferSource,
    },
    dataKey,
    ciphertextBuffer as unknown as BufferSource
  );

  return new Blob([decryptedBuffer], {
    type: options?.mimeType || "application/octet-stream",
  });
}

/**
 * Derive HMAC-SHA256 key from master dataKey via HKDF.
 */
export async function deriveHmacKey(
  dataKey: CryptoKey,
  salt?: Uint8Array | string,
  info?: Uint8Array | string
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const rawKey = await subtle.exportKey("raw", dataKey);

  const hkdfKey = await subtle.importKey("raw", rawKey as unknown as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);

  const saltBytes =
    typeof salt === "string" ? new TextEncoder().encode(salt) : (salt ?? new Uint8Array(32));

  const infoBytes =
    typeof info === "string"
      ? new TextEncoder().encode(info)
      : (info ?? new TextEncoder().encode("tx-hmac-key-v1"));

  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes as unknown as BufferSource,
      info: infoBytes as unknown as BufferSource,
    },
    hkdfKey,
    {
      name: "HMAC",
      hash: "SHA-256",
      length: 256,
    },
    false,
    ["sign", "verify"]
  );
}

/**
 * Serialize transaction fields: Date+Amount+Type+CleanedDescription+RunningBalance
 */
export function serializeTxFields(fields: TxHashFields | string | unknown[]): string {
  if (typeof fields === "string") return fields;
  if (Array.isArray(fields)) return fields.join("");

  const date = fields.date ?? fields.Date ?? "";
  const dateStr = date instanceof Date ? date.toISOString() : String(date);
  const amount = String(fields.amount ?? fields.Amount ?? "");
  const type = String(fields.type ?? fields.Type ?? "");
  const desc = String(fields.cleanedDescription ?? fields.CleanedDescription ?? "");
  const bal = String(fields.runningBalance ?? fields.RunningBalance ?? "");

  return `${dateStr}${amount}${type}${desc}${bal}`;
}

/**
 * 6. hmacTxHash(fields, hmacKey)
 * HMAC-SHA256 over Date+Amount+Type+CleanedDescription+RunningBalance,
 * with the HMAC key derived from the data key via HKDF.
 * Returns a 64-character lowercase hex signature.
 */
export async function hmacTxHash(
  fields: TxHashFields | string | unknown[],
  key: CryptoKey
): Promise<string> {
  const subtle = getSubtle();

  // If the passed key is the master dataKey (AES-GCM), automatically derive the HMAC key via HKDF
  let activeHmacKey = key;
  if (key.algorithm.name === "AES-GCM") {
    activeHmacKey = await deriveHmacKey(key);
  }

  const payload = serializeTxFields(fields);
  const encoded = new TextEncoder().encode(payload);

  const signature = await subtle.sign("HMAC", activeHmacKey, encoded as unknown as BufferSource);
  return bufferToHex(signature);
}

/**
 * 7. generateRecoveryCode(): human-readable code that can also unwrap the data key
 * Formats a 256-bit key into a human-readable, unambiguous Crockford Base32 recovery code.
 * Format: RC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 *
 * If dataKey is provided, exports it into the recovery code.
 * If dataKey is omitted, generates a fresh 256-bit key and returns the recovery code.
 */
export async function generateRecoveryCode(dataKey?: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  let rawBytes: Uint8Array;

  if (dataKey) {
    const raw = await subtle.exportKey("raw", dataKey);
    rawBytes = new Uint8Array(raw);
  } else {
    rawBytes = window.crypto.getRandomValues(new Uint8Array(32));
  }

  const base32 = encodeCrockfordBase32(rawBytes);

  // Split into chunks of 4 characters for human readability
  const chunks: string[] = [];
  for (let i = 0; i < base32.length; i += 4) {
    chunks.push(base32.slice(i, i + 4));
  }

  return `RC-${chunks.join("-")}`;
}

/**
 * Unwraps / restores the AES-GCM master data key directly from the human-readable recovery code.
 */
export async function unwrapDataKeyFromRecoveryCode(code: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const rawBytes = decodeRecoveryCode(code);

  return subtle.importKey(
    "raw",
    rawBytes as unknown as BufferSource,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Utility: Decodes a human-readable recovery code back into its 32 raw bytes
 */
export function decodeRecoveryCode(code: string): Uint8Array {
  // Strip "RC-" prefix and dashes/whitespace
  const cleaned = code.replace(/^RC-?/i, "").replace(/[\s-]/g, "");
  const bytes = decodeCrockfordBase32(cleaned);

  if (bytes.length < 32) {
    throw new Error(`Invalid recovery code: expected 32 bytes, got ${bytes.length} bytes.`);
  }

  // Slice first 32 bytes (256 bits)
  return bytes.slice(0, 32);
}
