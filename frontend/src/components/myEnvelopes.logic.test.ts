import { describe, it, expect } from "vitest";
import { countActionableClaimNfts, partitionEnvelopeSections, type SectionEnvelope } from "./myEnvelopes.logic";

function env(
  id: string,
  envelopeType: number,
  roleCls: "role-holder" | "role-creator" | null,
  isActive = true,
): SectionEnvelope {
  return {
    id,
    envelopeType,
    role: roleCls ? { text: roleCls, cls: roleCls } : null,
    isActive,
  };
}

describe("partitionEnvelopeSections", () => {
  it("places claim NFTs into dedicated claims section", () => {
    const input: SectionEnvelope[] = [
      env("10", 0, "role-holder", true),
      env("9", 2, "role-holder", true),
      env("8", 1, "role-creator", true),
      env("7", 2, "role-holder", false),
    ];

    const sections = partitionEnvelopeSections(input);

    expect(sections.claimNfts.map((item) => item.id)).toEqual(["9", "7"]);
    expect(sections.otherEnvelopes.map((item) => item.id)).toEqual(["8"]);
    expect(sections.spreadingNfts.map((item) => item.id)).toEqual(["10"]);
  });

  it("returns empty arrays for empty input", () => {
    const sections = partitionEnvelopeSections([]);
    expect(sections.spreadingNfts).toEqual([]);
    expect(sections.claimNfts).toEqual([]);
    expect(sections.otherEnvelopes).toEqual([]);
  });

  it("sorts spreading NFTs active-first then newest", () => {
    const input: SectionEnvelope[] = [
      env("1", 0, "role-holder", false),
      env("3", 0, "role-holder", true),
      env("2", 0, "role-holder", true),
    ];

    const ids = partitionEnvelopeSections(input).spreadingNfts.map((e) => e.id);
    expect(ids).toEqual(["3", "2", "1"]);
  });

  it("does not mutate the original array", () => {
    const input: SectionEnvelope[] = [env("2", 0, "role-holder"), env("1", 1, "role-creator")];
    const copy = [...input];
    partitionEnvelopeSections(input);
    expect(input.map((e) => e.id)).toEqual(copy.map((e) => e.id));
  });
});

describe("countActionableClaimNfts", () => {
  it("counts only active claim NFTs", () => {
    const claims: SectionEnvelope[] = [
      env("9", 2, "role-holder", true),
      env("7", 2, "role-holder", false),
      env("6", 2, "role-holder", true),
    ];

    expect(countActionableClaimNfts(claims)).toBe(2);
  });
});
