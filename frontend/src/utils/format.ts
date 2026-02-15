import { normalizeScriptHashHex, scriptHashHexToAddress } from "./neo";

const FIXED8_FACTOR = 100_000_000;

/** Convert human-readable amount to fixed8 integer (e.g. 1.5 → 150000000). Truncates beyond 8 decimals. */
export function toFixed8(value: number | string): number {
  // Normalize to fixed-point string to avoid scientific notation and float multiplication
  const str = typeof value === "string" ? value : Number(value).toFixed(8);
  const negative = str.startsWith("-");
  const abs = negative ? str.slice(1) : str;
  const [intPart = "0", decPart = ""] = abs.split(".");
  const padded = (decPart + "00000000").slice(0, 8);
  const result = Number(intPart) * FIXED8_FACTOR + Number(padded);
  return negative ? -result : result;
}

/** Convert fixed8 integer to human-readable (e.g. 150000000 → 1.5) */
export function fromFixed8(value: number | bigint | string): number {
  return Number(value) / FIXED8_FACTOR;
}

/** Format a Neo N3 address/hash for display (prefer full N3 address) */
export function formatHash(hash: string): string {
  if (!hash) return "";

  const normalized = normalizeScriptHashHex(hash);
  return normalized ? scriptHashHexToAddress(normalized) || hash : hash;
}

/** Format GAS amount with up to 8 decimal places, trimming trailing zeros */
export function formatGas(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  if (amount === 0) return "0";
  return amount.toFixed(8).replace(/\.?0+$/, "");
}

/** Extract a human-readable message from an unknown error */
export function extractError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  // Wallet dAPI errors are plain objects: { type, description, message, ... }
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const msg = obj.description ?? obj.message ?? obj.error;
    if (typeof msg === "string" && msg) return msg;
    // Last resort: try JSON for debugging
    try {
      return JSON.stringify(e);
    } catch {
      // fall through
    }
  }
  return String(e);
}
