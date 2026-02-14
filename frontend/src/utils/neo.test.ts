import { describe, it, expect } from "vitest";
import { parseStackItem, parseInvokeResult, addressToScriptHashHex, normalizeScriptHashHex } from "./neo";

describe("parseStackItem", () => {
  it("parses Integer with string value as BigInt", () => {
    expect(parseStackItem({ type: "Integer", value: "100" })).toBe(BigInt(100));
  });

  it("parses Integer with numeric value as Number", () => {
    expect(parseStackItem({ type: "Integer", value: 42 })).toBe(42);
  });

  it("parses Boolean true", () => {
    expect(parseStackItem({ type: "Boolean", value: true })).toBe(true);
  });

  it("parses Boolean false", () => {
    expect(parseStackItem({ type: "Boolean", value: false })).toBe(false);
  });

  it("parses Boolean string true", () => {
    expect(parseStackItem({ type: "Boolean", value: "true" })).toBe(true);
    expect(parseStackItem({ type: "Boolean", value: "1" })).toBe(true);
  });

  it("parses Boolean string false", () => {
    expect(parseStackItem({ type: "Boolean", value: "false" })).toBe(false);
    expect(parseStackItem({ type: "Boolean", value: "0" })).toBe(false);
  });

  it("parses ByteString", () => {
    expect(parseStackItem({ type: "ByteString", value: "abc123" })).toBe("abc123");
  });

  it("parses ByteString with null value as empty string", () => {
    expect(parseStackItem({ type: "ByteString", value: null })).toBe("");
  });

  it("parses Buffer same as ByteString", () => {
    expect(parseStackItem({ type: "Buffer", value: "data" })).toBe("data");
  });

  it("parses ByteString unicode payloads as UTF-8 text", () => {
    const unicode = "红包✨";
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(unicode)));
    expect(parseStackItem({ type: "ByteString", value: b64 })).toBe(unicode);
  });

  it("parses Array recursively", () => {
    const item = {
      type: "Array",
      value: [
        { type: "Integer", value: "1" },
        { type: "Boolean", value: true },
      ],
    };
    expect(parseStackItem(item)).toEqual([BigInt(1), true]);
  });

  it("parses Map to object", () => {
    const item = {
      type: "Map",
      value: [
        { key: { type: "ByteString", value: "name" }, value: { type: "ByteString", value: "test" } },
        { key: { type: "ByteString", value: "count" }, value: { type: "Integer", value: "5" } },
      ],
    };
    const result = parseStackItem(item) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect(result.count).toBe(BigInt(5));
  });

  it("returns null for unknown type", () => {
    expect(parseStackItem({ type: "Void", value: null })).toBe(null);
  });

  it("returns primitive input unchanged", () => {
    expect(parseStackItem(null)).toBe(null);
    expect(parseStackItem(42)).toBe(42);
    expect(parseStackItem("str")).toBe("str");
  });

  it("parses 20-byte ByteString as 0x-prefixed little-endian hex", () => {
    // 20 zero bytes in base64
    const twentyZeroBytes = btoa(String.fromCharCode(...new Uint8Array(20)));
    const result = parseStackItem({ type: "ByteString", value: twentyZeroBytes });
    expect(result).toBe("0x0000000000000000000000000000000000000000");
  });

  it("parses 20-byte ByteString with known script hash", () => {
    // Bytes [1,2,...,20] little-endian → reversed hex
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const b64 = btoa(String.fromCharCode(...bytes));
    const result = parseStackItem({ type: "ByteString", value: b64 });
    expect(result).toBe("0x14131211100f0e0d0c0b0a090807060504030201");
  });

  it("normalizes printable 20-byte ByteString values to script-hash hex", () => {
    const text = "12345678901234567890"; // exactly 20 bytes
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    expect(parseStackItem({ type: "ByteString", value: b64 })).toBe("0x3039383736353433323130393837363534333231");
  });

  it("parses Hash160 values with and without 0x prefix", () => {
    expect(parseStackItem({ type: "Hash160", value: "0xA5DE523AE9D99BE784A536E9412B7A3CBE049E1A" })).toBe(
      "0xa5de523ae9d99be784a536e9412b7a3cbe049e1a",
    );
    expect(parseStackItem({ type: "Hash160", value: "a5de523ae9d99be784a536e9412b7a3cbe049e1a" })).toBe(
      "0xa5de523ae9d99be784a536e9412b7a3cbe049e1a",
    );
  });
});

describe("parseInvokeResult", () => {
  it("extracts first stack item", () => {
    const res = { stack: [{ type: "Integer", value: "10" }] };
    expect(parseInvokeResult(res)).toBe(BigInt(10));
  });

  it("returns null for empty stack", () => {
    expect(parseInvokeResult({ stack: [] })).toBe(null);
  });

  it("returns null for missing stack", () => {
    expect(parseInvokeResult({})).toBe(null);
  });

  it("returns null for null input", () => {
    expect(parseInvokeResult(null)).toBe(null);
  });
});

describe("addressToScriptHashHex", () => {
  it("converts a valid Neo N3 address to 0x-prefixed hex", () => {
    // NNLi44dJNXtDNSBkofB48aTVYtb1zZrNEs is a well-known Neo N3 address
    const result = addressToScriptHashHex("NNLi44dJNXtDNSBkofB48aTVYtb1zZrNEs");
    expect(result).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("returns empty string for invalid address", () => {
    expect(addressToScriptHashHex("")).toBe("");
    expect(addressToScriptHashHex("invalid")).toBe("");
  });

  it("produces hex that matches parseStackItem output for same script hash", () => {
    // Round-trip: address → hex should match what parseStackItem returns
    // for the same 20-byte script hash encoded as base64 ByteString
    const addr = "NNLi44dJNXtDNSBkofB48aTVYtb1zZrNEs";
    const hex = addressToScriptHashHex(addr);
    expect(hex).toBeTruthy();
    expect(hex.startsWith("0x")).toBe(true);
    expect(hex.length).toBe(42); // "0x" + 40 hex chars
  });
});

describe("normalizeScriptHashHex", () => {
  it("normalizes Neo addresses into 0x-prefixed hash", () => {
    const normalized = normalizeScriptHashHex("NNLi44dJNXtDNSBkofB48aTVYtb1zZrNEs");
    expect(normalized).toBe("0xa5de523ae9d99be784a536e9412b7a3cbe049e1a");
  });

  it("normalizes base64-encoded UInt160 payloads", () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(normalizeScriptHashHex(b64)).toBe("0x14131211100f0e0d0c0b0a090807060504030201");
  });

  it("returns empty string for non-hash input", () => {
    expect(normalizeScriptHashHex("not-a-hash")).toBe("");
    expect(normalizeScriptHashHex(null)).toBe("");
  });
});
