import { describe, expect, it } from "vitest";
import { mapWalletConnectError } from "./searchClaim.logic";

describe("mapWalletConnectError", () => {
  const t = () => "Wallet extension not detected";

  it("maps missing-wallet errors to localized wallet-not-detected text", () => {
    const err = new Error("No Neo wallet detected");
    expect(mapWalletConnectError(err, t)).toBe("Wallet extension not detected");
  });

  it("keeps specific non-wallet errors untouched", () => {
    const err = new Error("User rejected request");
    expect(mapWalletConnectError(err, t)).toBe("User rejected request");
  });

  it("handles non-Error throwables", () => {
    expect(mapWalletConnectError("boom", t)).toBe("boom");
  });
});
