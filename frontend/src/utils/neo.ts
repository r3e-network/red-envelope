// ── Base58 decode (Neo N3 address → script hash) ─────────────────
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  const map = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i++) map.set(BASE58_ALPHABET[i], i);

  let bytes = [0];
  for (const ch of str) {
    const val = map.get(ch);
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
 * Convert a Neo N3 address (e.g. "NLtL2v28d7T...") to the base64-encoded
 * UInt160 script hash that the contract returns for creator/currentHolder.
 */
export function addressToBase64ScriptHash(address: string): string {
  try {
    const decoded = base58Decode(address);
    // Neo N3 address = 1 version + 20 script-hash + 4 checksum = 25 bytes
    if (decoded.length !== 25) return "";
    const scriptHash = decoded.slice(1, 21);
    return btoa(String.fromCharCode(...scriptHash));
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
      return Boolean(value);
    case "ByteString":
    case "Buffer":
      return value ? String(value) : "";
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
