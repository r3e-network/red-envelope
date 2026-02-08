import { describe, it, expect } from "vitest";
import { parseStackItem, parseInvokeResult } from "./neo";

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
