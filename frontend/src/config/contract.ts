const ZERO_HASH = "0x0000000000000000000000000000000000000000";
const HASH_RE = /^0x[0-9a-fA-F]{40}$/;

// Existing deployed contract (Neo N3 testnet) used as a safe default.
export const DEFAULT_CONTRACT_HASH = "0xf2649c2b6312d8c7b4982c0c597c9772a2595b1e";

export function resolveContractHash(value: string | undefined): string {
  if (!value) {
    return DEFAULT_CONTRACT_HASH;
  }

  const normalized = value.trim().toLowerCase();
  if (!HASH_RE.test(normalized) || normalized === ZERO_HASH) {
    return DEFAULT_CONTRACT_HASH;
  }

  return normalized;
}

export const CONTRACT_HASH = resolveContractHash(import.meta.env.VITE_CONTRACT_HASH);

