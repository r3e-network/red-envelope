import { sha256 } from "js-sha256";

// ── Base58 decode (Neo N3 address → script hash) ─────────────────
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map<string, number>();
for (let i = 0; i < BASE58_ALPHABET.length; i++) BASE58_MAP.set(BASE58_ALPHABET[i], i);
const HASH160_RE = /^[0-9a-f]{40}$/;
const HASH160_PREFIX_RE = /^0x[0-9a-f]{40}$/;
const NEO_ADDRESS_RE = /^N[1-9A-HJ-NP-Za-km-z]{33}$/;
const NEO_N3_ADDRESS_VERSION = 0x35;

function bytesToScriptHashHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .reverse()
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function scriptHashHexToBytes(hash: string): Uint8Array {
  const h = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (!/^[0-9a-f]{40}$/i.test(h)) return new Uint8Array();
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function doubleSha256(input: Uint8Array): Uint8Array {
  const first = Uint8Array.from(sha256.array(input));
  return Uint8Array.from(sha256.array(first));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function base58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (const ch of str) {
    const val = BASE58_MAP.get(ch);
    if (val === undefined) throw new Error(`Invalid base58 char: ${ch}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's → leading zero bytes
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function base58Encode(input: Uint8Array): string {
  if (input.length === 0) return "";
  const digits = [0];

  for (const byte of input) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === 0) leadingZeros++;

  let out = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out;
}

/**
 * Convert a Neo N3 address (e.g. "NLtL2v28d7T...") to the 0x-prefixed
 * little-endian hex script hash that parseStackItem returns for 20-byte values.
 */
export function addressToScriptHashHex(address: string): string {
  try {
    const decoded = base58Decode(address);
    // Neo N3 address = 1 version + 20 script-hash + 4 checksum = 25 bytes
    if (decoded.length !== 25) return "";
    if (decoded[0] !== NEO_N3_ADDRESS_VERSION) return "";

    const payload = decoded.slice(0, 21);
    const checksum = decoded.slice(21, 25);
    const expected = doubleSha256(payload).slice(0, 4);
    if (!bytesEqual(checksum, expected)) return "";

    const scriptHash = decoded.slice(1, 21);
    return bytesToScriptHashHex(scriptHash);
  } catch {
    return "";
  }
}

/**
 * Convert 0x-prefixed little-endian UInt160 script hash to Neo N3 address.
 */
export function scriptHashHexToAddress(value: string): string {
  const normalized = normalizeScriptHashHex(value);
  if (!normalized) return "";

  const littleEndian = scriptHashHexToBytes(normalized);
  if (littleEndian.length !== 20) return "";
  const scriptHash = Uint8Array.from(littleEndian).reverse();

  const payload = new Uint8Array(21);
  payload[0] = NEO_N3_ADDRESS_VERSION;
  payload.set(scriptHash, 1);
  const checksum = doubleSha256(payload).slice(0, 4);

  const full = new Uint8Array(25);
  full.set(payload, 0);
  full.set(checksum, 21);
  return base58Encode(full);
}

/**
 * Normalize script-hash-ish values into 0x-prefixed lowercase UInt160 hex.
 * Accepts:
 * - "0x..." or bare 40-hex
 * - Neo N3 addresses (N...)
 * - base64-encoded 20-byte payloads
 */
export function normalizeScriptHashHex(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (HASH160_PREFIX_RE.test(lower)) return lower;
  if (HASH160_RE.test(lower)) return `0x${lower}`;

  if (NEO_ADDRESS_RE.test(raw)) return addressToScriptHashHex(raw);

  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (bytes.length === 20) return bytesToScriptHashHex(bytes);
  } catch {
    // not base64
  }

  return "";
}

/** Parse a Neo N3 stack item from invokeRead response */
export function parseStackItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const si = item as Record<string, unknown>;
  const type = String(si.type || "");
  const value = si.value;

  switch (type) {
    case "Integer":
      if (typeof value === "string") {
        try {
          return BigInt(value);
        } catch {
          return Number(value) || 0;
        }
      }
      return Number(value ?? 0);
    case "Boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") return true;
        return false; // any other string (including empty, "false", "0") → false
      }
      return value != null && value !== 0;
    case "ByteString":
    case "Buffer": {
      if (!value) return "";
      try {
        const binary = atob(String(value));
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

        // Neo UInt160 script hashes are 20-byte byte strings.
        // Always normalize these to 0x-prefixed little-endian hex so address matching is stable.
        if (bytes.length === 20) {
          return bytesToScriptHashHex(bytes);
        }

        const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return decodedText;
      } catch {
        return String(value);
      }
    }
    case "Hash160": {
      const normalized = normalizeScriptHashHex(value);
      return normalized || String(value ?? "");
    }
    case "Array":
      return Array.isArray(value) ? value.map(parseStackItem) : [];
    case "Map": {
      const entries = Array.isArray(value) ? value : [];
      const map: Record<string, unknown> = {};
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const k = String(parseStackItem(e.key) ?? "");
        map[k] = parseStackItem(e.value);
      }
      return map;
    }
    default:
      return value ?? null;
  }
}

/** Extract result from invokeRead response */
export function parseInvokeResult(res: unknown): unknown {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  const stack = r.stack as unknown[];
  if (!Array.isArray(stack) || stack.length === 0) return null;
  return parseStackItem(stack[0]);
}
