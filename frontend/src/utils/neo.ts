// ── Base58 decode (Neo N3 address → script hash) ─────────────────
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map<string, number>();
for (let i = 0; i < BASE58_ALPHABET.length; i++) BASE58_MAP.set(BASE58_ALPHABET[i], i);

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

/**
 * Convert a Neo N3 address (e.g. "NLtL2v28d7T...") to the 0x-prefixed
 * little-endian hex script hash that parseStackItem returns for 20-byte values.
 */
export function addressToScriptHashHex(address: string): string {
  try {
    const decoded = base58Decode(address);
    // Neo N3 address = 1 version + 20 script-hash + 4 checksum = 25 bytes
    if (decoded.length !== 25) return "";
    const scriptHash = decoded.slice(1, 21);
    return (
      "0x" +
      Array.from(scriptHash)
        .reverse()
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return "";
  }
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
        const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        // eslint-disable-next-line no-control-regex
        const hasControlChars = /[\u0000-\u001f\u007f]/.test(decodedText);
        if (!hasControlChars) return decodedText;

        // UInt160 script hashes are exactly 20 bytes and often non-printable.
        // Only treat as hash when payload does not look like display text.
        if (bytes.length === 20) {
          return (
            "0x" +
            Array.from(bytes)
              .reverse()
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          );
        }
        return decodedText;
      } catch {
        return String(value);
      }
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
