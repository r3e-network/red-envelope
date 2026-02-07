import { describe, it, expect } from "vitest";
import { toUnixMs, msUntilExpiry } from "./time";

describe("msUntilExpiry", () => {
  it("treats contract timestamps as unix seconds", () => {
    const nowMs = Date.UTC(2026, 1, 7, 12, 0, 0);
    const expirySeconds = Math.floor(nowMs / 1000) + 2 * 86400 + 5 * 3600;

    const diff = msUntilExpiry(expirySeconds, nowMs);
    const expected = 2 * 86400000 + 5 * 3600000;

    expect(diff).toBe(expected);
  });

  it("returns zero when already expired", () => {
    const nowMs = Date.UTC(2026, 1, 7, 12, 0, 0);
    const expirySeconds = Math.floor(nowMs / 1000) - 1;
    expect(msUntilExpiry(expirySeconds, nowMs)).toBe(0);
  });
});

describe("toUnixMs", () => {
  it("converts seconds to milliseconds", () => {
    expect(toUnixMs(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("returns milliseconds unchanged", () => {
    expect(toUnixMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("returns 0 for zero input", () => {
    expect(toUnixMs(0)).toBe(0);
  });

  it("returns 0 for negative input", () => {
    expect(toUnixMs(-1)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(toUnixMs(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(toUnixMs(Infinity)).toBe(0);
  });
});
