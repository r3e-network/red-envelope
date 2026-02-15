import type { EnrichedEnvelope } from "./EnvelopeCard.vue";

export type SectionEnvelope = Pick<EnrichedEnvelope, "id" | "envelopeType" | "role" | "isActive">;

export function sortByNewest(a: { id: string }, b: { id: string }): number {
  return Number(b.id) - Number(a.id);
}

export function sortSpreadingNfts(
  a: Pick<EnrichedEnvelope, "id" | "isActive">,
  b: Pick<EnrichedEnvelope, "id" | "isActive">,
): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return sortByNewest(a, b);
}

export function sortByActivityThenNewest(
  a: Pick<EnrichedEnvelope, "id" | "isActive">,
  b: Pick<EnrichedEnvelope, "id" | "isActive">,
): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return sortByNewest(a, b);
}

export function partitionEnvelopeSections<T extends SectionEnvelope>(
  envelopes: T[],
): {
  spreadingNfts: T[];
  claimNfts: T[];
  otherEnvelopes: T[];
} {
  const isSpreadingHolder = (env: T) => env.envelopeType === 0 && env.role?.cls === "role-holder";
  const isClaimHolder = (env: T) => env.envelopeType === 2 && env.role?.cls === "role-holder";

  const spreadingNfts = envelopes.filter(isSpreadingHolder).sort(sortSpreadingNfts);
  const claimNfts = envelopes.filter(isClaimHolder).sort(sortByActivityThenNewest);
  const otherEnvelopes = envelopes
    .filter((env) => !isSpreadingHolder(env) && !isClaimHolder(env))
    .sort(sortByActivityThenNewest);

  return { spreadingNfts, claimNfts, otherEnvelopes };
}

export function countActionableClaimNfts<T extends Pick<SectionEnvelope, "isActive">>(claimNfts: T[]): number {
  return claimNfts.filter((item) => item.isActive).length;
}
