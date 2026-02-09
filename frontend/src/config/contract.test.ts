import { describe, it, expect } from "vitest";
import { resolveContractHash } from "./contract";
import { NETWORKS, DEFAULT_NETWORK } from "./networks";

const TESTNET_HASH = NETWORKS[DEFAULT_NETWORK].contractHash;

describe("contract config", () => {
  it("falls back to active network hash when env is missing", () => {
    expect(resolveContractHash(undefined)).toBe(TESTNET_HASH);
  });

  it("falls back to active network hash for all-zero placeholder", () => {
    expect(resolveContractHash("0x0000000000000000000000000000000000000000")).toBe(TESTNET_HASH);
  });

  it("normalizes valid hashes", () => {
    expect(resolveContractHash("0x36A46AA95413029E340E57365CDADD3AE29244FF")).toBe(
      "0x36a46aa95413029e340e57365cdadd3ae29244ff",
    );
  });
});
