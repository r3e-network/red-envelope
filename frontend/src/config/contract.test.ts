import { describe, it, expect } from "vitest";
import { DEFAULT_CONTRACT_HASH, resolveContractHash } from "./contract";

describe("contract config", () => {
  it("falls back to default hash when env is missing", () => {
    expect(resolveContractHash(undefined)).toBe(DEFAULT_CONTRACT_HASH);
  });

  it("falls back to default hash for all-zero placeholder", () => {
    expect(resolveContractHash("0x0000000000000000000000000000000000000000")).toBe(DEFAULT_CONTRACT_HASH);
  });

  it("normalizes valid hashes", () => {
    expect(resolveContractHash("0xF2649C2B6312D8C7B4982C0C597C9772A2595B1E")).toBe(
      "0xf2649c2b6312d8c7b4982c0c597c9772a2595b1e"
    );
  });
});
