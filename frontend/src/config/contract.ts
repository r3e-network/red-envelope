import { resolveNetwork } from "./networks";

const ZERO_HASH = "0x0000000000000000000000000000000000000000";
const HASH_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Resolve contract hash with priority:
 * 1. VITE_CONTRACT_HASH env var (explicit override)
 * 2. Network-specific hash from networks.ts (derived from VITE_NETWORK)
 */
export function resolveContractHash(envOverride: string | undefined): string {
  if (envOverride) {
    const normalized = envOverride.trim().toLowerCase();
    if (HASH_RE.test(normalized) && normalized !== ZERO_HASH) {
      return normalized;
    }
  }

  // Fall back to the contract hash for the active network
  return resolveNetwork().contractHash;
}

export const CONTRACT_HASH = resolveContractHash(import.meta.env.VITE_CONTRACT_HASH);
