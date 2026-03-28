import { createHmac } from "crypto";

const UUID_SECRET_ENV_KEYS = [
  "GAZE_UUID_ENCRYPTION_KEY",
  "UUID_ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
] as const;

export function normalizeEmailForUuid(email: string) {
  return email.trim().toLowerCase();
}

export function resolveUuidSecret() {
  for (const envKey of UUID_SECRET_ENV_KEYS) {
    const value = process.env[envKey]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatUuid(bytes: Uint8Array) {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function deriveStableUuidFromEmail(email: string, secret: string) {
  const normalizedEmail = normalizeEmailForUuid(email);
  const digest = createHmac("sha256", secret).update(normalizedEmail).digest();
  const bytes = new Uint8Array(digest.subarray(0, 16));

  // Encode as an RFC 4122-compliant UUID variant/version.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}
