import { describe, it, expect } from "vitest";
import { parseOptionalNumber } from "./createForm.logic";

describe("CreateForm submission normalization", () => {
  it("preserves explicit zero values for NEO gate fields", () => {
    const params = {
      minNeo: parseOptionalNumber("0", 100),
      minHoldDays: parseOptionalNumber("0", 2),
    };

    expect(params.minNeo).toBe(0);
    expect(params.minHoldDays).toBe(0);
  });

  it("uses fallback for blank values", () => {
    expect(parseOptionalNumber("", 100)).toBe(100);
    expect(parseOptionalNumber("   ", 2)).toBe(2);
  });

  it("uses fallback for non-numeric values", () => {
    expect(parseOptionalNumber("abc", 100)).toBe(100);
  });

  it("uses fallback for Infinity and NaN strings", () => {
    expect(parseOptionalNumber("Infinity", 100)).toBe(100);
    expect(parseOptionalNumber("-Infinity", 100)).toBe(100);
    expect(parseOptionalNumber("NaN", 100)).toBe(100);
  });

  it("parses decimal and negative values as-is", () => {
    expect(parseOptionalNumber("0.5", 100)).toBe(0.5);
    expect(parseOptionalNumber("-3", 100)).toBe(-3);
  });
});
