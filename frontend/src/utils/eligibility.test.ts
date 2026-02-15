import { describe, expect, it } from "vitest";
import { mapEligibilityReason } from "./eligibility";

describe("mapEligibilityReason", () => {
  const t = (key: string): string => `i18n:${key}`;

  it("maps common eligibility reasons to localized keys", () => {
    expect(mapEligibilityReason("insufficient NEO", t)).toBe("i18n:insufficientNeo");
    expect(mapEligibilityReason("hold duration not met", t)).toBe("i18n:holdNotMet");
    expect(mapEligibilityReason("already claimed", t)).toBe("i18n:alreadyClaimedPool");
    expect(mapEligibilityReason("expired", t)).toBe("i18n:expired");
    expect(mapEligibilityReason("depleted", t)).toBe("i18n:depleted");
    expect(mapEligibilityReason("not active", t)).toBe("i18n:eligibilityNotActive");
    expect(mapEligibilityReason("not NFT holder", t)).toBe("i18n:eligibilityNotHolder");
  });

  it("falls back to raw reason for unknown values", () => {
    expect(mapEligibilityReason("custom reason", t)).toBe("custom reason");
  });
});
