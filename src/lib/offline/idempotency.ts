/**
 * Market-Hub ERP - Idempotency & Unique Reference Generator
 * Guarantees zero duplicate execution on Supabase server retries.
 */

/**
 * Generates a pseudo-UUIDv7 with time-ordered prefix for indexed performance.
 */
export function generateUUIDv7(): string {
  const timestamp = Date.now();
  const timeHex = timestamp.toString(16).padStart(12, "0");

  // Random bytes for uniqueness
  const randomHex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");

  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${randomHex.slice(1, 4)}-a${randomHex.slice(5, 8)}-${randomHex.slice(8, 20)}`;
}

/**
 * Creates a deterministic idempotency key for an operation.
 * Formatted as: `${deviceId}:${entity}:${localId}:${operationType}`
 */
export function generateIdempotencyKey(
  deviceId: string,
  entityName: string,
  localId: string,
  operationType: string = "CREATE",
): string {
  const sanitizedDevice = deviceId.trim().toLowerCase() || "dev-unknown";
  const sanitizedEntity = entityName.trim().toLowerCase();
  return `${sanitizedDevice}:${sanitizedEntity}:${operationType.toUpperCase()}:${localId}`;
}

/**
 * Generates a local, human-readable document reference for printable receipts offline.
 * Example output: `POS-DEV01-20260930-0042`
 */
export function generateLocalDocRef(
  prefix: string,
  deviceId: string,
  sequenceNumber: number,
  date: Date = new Date(),
): string {
  const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cleanDevice =
    deviceId
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(-6) || "DEV01";

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;

  const seqStr = String(sequenceNumber).padStart(4, "0");
  return `${cleanPrefix}-${cleanDevice}-${dateStr}-${seqStr}`;
}

/**
 * Generates or retrieves stored device identity for this client.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return "srv-node-device";
  }

  const STORAGE_KEY = "markethub_device_id";
  let deviceId = localStorage.getItem(STORAGE_KEY);
  if (!deviceId) {
    deviceId = `DEV-${generateUUIDv7().slice(0, 8).toUpperCase()}`;
    localStorage.setItem(STORAGE_KEY, deviceId);
  }
  return deviceId;
}
