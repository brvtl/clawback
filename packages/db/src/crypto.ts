import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get or generate the encryption key.
 * Uses CLAWBACK_ENCRYPTION_KEY env var, or generates a deterministic key from a passphrase.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.CLAWBACK_ENCRYPTION_KEY;

  if (envKey) {
    // If key is provided as hex, use it directly
    if (envKey.length === 64) {
      return Buffer.from(envKey, "hex");
    }
    // Otherwise derive from passphrase
    return scryptSync(envKey, "clawback-salt", 32);
  }

  // Fallback: derive from machine-specific value or default
  // In production, CLAWBACK_ENCRYPTION_KEY should always be set
  const fallback = process.env.HOME ?? process.env.USERPROFILE ?? "clawback-default";
  return scryptSync(fallback, "clawback-salt", 32);
}

/**
 * Encrypt a string value.
 * Returns base64-encoded string containing: salt + iv + authTag + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: iv + authTag + encrypted
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypt a string value.
 * Expects base64-encoded string containing: iv + authTag + ciphertext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(ciphertext, "base64");

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt all values in an env object.
 */
export function encryptEnv(env: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    encrypted[key] = encrypt(value);
  }
  return encrypted;
}

/**
 * Decrypt all values in an env object.
 */
export function decryptEnv(env: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    try {
      decrypted[key] = decrypt(value);
    } catch {
      // If decryption fails, value might be unencrypted (legacy data)
      decrypted[key] = value;
    }
  }
  return decrypted;
}

/**
 * Check if a value appears to be encrypted (base64 with correct structure).
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = Buffer.from(value, "base64");
    // Must be at least IV + authTag + 1 byte of ciphertext
    return decoded.length > IV_LENGTH + AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}
