import { describe, it, expect } from "vitest";
import { toFixed8, fromFixed8, formatHash, formatGas, extractError } from "./format";

describe("toFixed8", () => {
  it("converts whole number", () => {
    expect(toFixed8(1)).toBe(100_000_000);
  });

  it("converts decimal", () => {
    expect(toFixed8(0.1)).toBe(10_000_000);
  });

  it("accepts string input", () => {
    expect(toFixed8("2.5")).toBe(250_000_000);
  });

  it("rounds to nearest integer", () => {
    expect(toFixed8(0.000000005)).toBe(1);
  });

  it("returns 0 for zero", () => {
    expect(toFixed8(0)).toBe(0);
  });
});

describe("fromFixed8", () => {
  it("converts fixed8 to human-readable", () => {
    expect(fromFixed8(150_000_000)).toBe(1.5);
  });

  it("handles zero", () => {
    expect(fromFixed8(0)).toBe(0);
  });

  it("accepts bigint", () => {
    expect(fromFixed8(BigInt(100_000_000))).toBe(1);
  });

  it("accepts string", () => {
    expect(fromFixed8("50000000")).toBe(0.5);
  });
});

describe("formatHash", () => {
  it("formats script hash as Neo N3 address", () => {
    expect(formatHash("0xa5de523ae9d99be784a536e9412b7a3cbe049e1a")).toBe("NNLi44dJ...zZrNEs");
  });

  it("keeps Neo address style for address input", () => {
    expect(formatHash("NNLi44dJNXtDNSBkofB48aTVYtb1zZrNEs")).toBe("NNLi44dJ...zZrNEs");
  });

  it("returns unrecognized strings unchanged", () => {
    expect(formatHash("0xabc")).toBe("0xabc");
  });

  it("returns empty string for falsy input", () => {
    expect(formatHash("")).toBe("");
  });
});

describe("formatGas", () => {
  it("formats zero", () => {
    expect(formatGas(0)).toBe("0");
  });

  it("trims trailing zeros", () => {
    expect(formatGas(1.5)).toBe("1.5");
  });

  it("trims trailing decimal point", () => {
    expect(formatGas(10)).toBe("10");
  });

  it("preserves significant decimals", () => {
    expect(formatGas(0.00000001)).toBe("0.00000001");
  });
});

describe("extractError", () => {
  it("extracts Error message", () => {
    expect(extractError(new Error("boom"))).toBe("boom");
  });

  it("returns string as-is", () => {
    expect(extractError("fail")).toBe("fail");
  });

  it("stringifies unknown types", () => {
    expect(extractError(42)).toBe("42");
  });
});
