import { describe, it, expect } from "vitest";
import { parseOptionalNumber } from "./createForm.logic";

describe("CreateForm submission normalization", () => {
  it("preserves explicit zero values for NEO gate fields", () => {
    const params = {
      minNeo: parseOptionalNumber("0", 0),
      minHoldDays: parseOptionalNumber("0", 0),
    };

    expect(params.minNeo).toBe(0);
    expect(params.minHoldDays).toBe(0);
  });

  it("uses fallback for blank values", () => {
    expect(parseOptionalNumber("", 0)).toBe(0);
    expect(parseOptionalNumber("   ", 0)).toBe(0);
  });

  it("uses fallback for non-numeric values", () => {
    expect(parseOptionalNumber("abc", 0)).toBe(0);
  });

  it("uses fallback for Infinity and NaN strings", () => {
    expect(parseOptionalNumber("Infinity", 0)).toBe(0);
    expect(parseOptionalNumber("-Infinity", 0)).toBe(0);
    expect(parseOptionalNumber("NaN", 0)).toBe(0);
  });

  it("parses decimal and negative values as-is", () => {
    expect(parseOptionalNumber("0.5", 0)).toBe(0.5);
    expect(parseOptionalNumber("-3", 0)).toBe(-3);
  });
});
