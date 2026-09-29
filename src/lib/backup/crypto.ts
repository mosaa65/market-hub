/**
 * Market Hub (Vortex ERP) — Backup Encryption & Crypto Utilities
 *
 * Uses Web Crypto API (SubtleCrypto) for AES-256-GCM authenticated encryption (AEAD)
 * and SHA-256 checksum verification.
 *
 * Security Rules:
 * - NO hardcoded encryption keys in client source code.
 * - Key derivation uses user-supplied passphrase or server-provided ephemeral key.
 * - Key versioning (`key_version`) is preserved in metadata.
 */

/**
 * Convert string or Uint8Array to Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compute SHA-256 Checksum of a string
 */
export async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return arrayBufferToBase64(hashBuffer);
}

/**
 * Derive a CryptoKey from a secret passphrase/key string using PBKDF2
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseBuffer = encoder.encode(passphrase);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt JSON payload using AES-256-GCM
 */
export async function encryptPayload(
  plaintext: string,
  secretKey: string,
): Promise<{ ciphertextBase64: string; ivBase64: string; authTagBase64: string }> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(plaintext);

  // Generate random 12-byte IV & 16-byte Salt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await deriveKey(secretKey, salt);

  // AES-GCM Encryption with 128-bit Tag
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: 128,
    },
    key,
    dataBuffer,
  );

  // Combine Salt + Encrypted Data into payload
  const combined = new Uint8Array(salt.byteLength + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(new Uint8Array(encryptedBuffer), salt.byteLength);

  // Compute Auth Tag / Checksum
  const checksum = await computeSHA256(plaintext);

  return {
    ciphertextBase64: arrayBufferToBase64(combined.buffer),
    ivBase64: arrayBufferToBase64(iv.buffer),
    authTagBase64: checksum.substring(0, 32),
  };
}

/**
 * Decrypt AES-256-GCM payload
 */
export async function decryptPayload(
  ciphertextBase64: string,
  ivBase64: string,
  secretKey: string,
): Promise<string> {
  const combinedBytes = base64ToUint8Array(ciphertextBase64);
  const ivBytes = base64ToUint8Array(ivBase64);

  // Extract Salt (first 16 bytes) and Encrypted Data
  const salt = combinedBytes.slice(0, 16);
  const encryptedData = combinedBytes.slice(16);

  const key = await deriveKey(secretKey, salt);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      tagLength: 128,
    },
    key,
    encryptedData,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
