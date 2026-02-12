import { describe, it, expect } from "vitest";
import { resolveContractHash } from "./contract";
import { resolveNetwork } from "./networks";

const ACTIVE_NETWORK_HASH = resolveNetwork().contractHash;

describe("contract config", () => {
  it("falls back to active network hash when env is missing", () => {
    expect(resolveContractHash(undefined)).toBe(ACTIVE_NETWORK_HASH);
  });

  it("falls back to active network hash for all-zero placeholder", () => {
    expect(resolveContractHash("0x0000000000000000000000000000000000000000")).toBe(ACTIVE_NETWORK_HASH);
  });

  it("normalizes valid hashes", () => {
    expect(resolveContractHash("0x36A46AA95413029E340E57365CDADD3AE29244FF")).toBe(
      "0x36a46aa95413029e340e57365cdadd3ae29244ff",
    );
  });
});
