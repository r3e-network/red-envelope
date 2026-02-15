import { ref } from "vue";
import { useWallet } from "./useWallet";
import { CONTRACT_HASH } from "@/config/contract";
import { resolveNetwork } from "@/config/networks";
import { fromFixed8, toFixed8 } from "@/utils/format";
import { normalizeScriptHashHex, parseInvokeResult } from "@/utils/neo";
import { pAll } from "@/utils/concurrency";

export const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";

export const MIN_AMOUNT = 100_000_000; // 1 GAS fixed8
export const MAX_PACKETS = 100;
export const MIN_PER_PACKET = 10_000_000; // 0.1 GAS fixed8
const ENVELOPE_ID_STORAGE_KEY_B64 = "Eg=="; // storage key 0x12 (PREFIX_ENVELOPE_ID)
const MAX_ENVELOPE_ID_PROBE = 1_000_000;

export type EnvelopeItem = {
  id: string;
  creator: string;
  envelopeType: number;
  parentEnvelopeId: string;
  totalAmount: number;
  packetCount: number;
  openedCount: number;
  claimedCount: number;
  remainingAmount: number;
  remainingPackets: number;
  minNeoRequired: number;
  minHoldSeconds: number;
  active: boolean;
  expired: boolean;
  depleted: boolean;
  currentHolder: string;
  message: string;
  expiryTime: number;
};

export function useRedEnvelope() {
  const { address, invoke, invokeRead } = useWallet();

  const isLoading = ref(false);
  const claimLoading = ref(false);
  const envelopes = ref<EnvelopeItem[]>([]);
  const loadingEnvelopes = ref(false);

  /** Create envelope by sending GAS to contract via OnNEP17Payment */
  const createEnvelope = async (params: {
    totalGas: number;
    packetCount: number;
    expiryHours: number;
    message: string;
    minNeo: number;
    minHoldDays: number;
    envelopeType?: number; // 0=spreading (default), 1=pool
  }): Promise<string> => {
    isLoading.value = true;
    try {
      const amount = toFixed8(params.totalGas);
      validate(amount, params.packetCount, params.expiryHours, params.message, params.minNeo, params.minHoldDays);

      // Contract adds expiry directly to Runtime.Time (milliseconds), so send ms
      const expiryMs = params.expiryHours * 3_600_000;
      const minNeo = params.minNeo;
      const minHoldSeconds = params.minHoldDays * 86400;

      // Send GAS to contract with config data array
      const res = assertTxResult(
        await invoke({
          scriptHash: GAS_HASH,
          operation: "transfer",
          args: [
            { type: "Hash160", value: address.value },
            { type: "Hash160", value: CONTRACT_HASH },
            { type: "Integer", value: String(amount) },
            {
              type: "Array",
              value: [
                { type: "Integer", value: String(params.packetCount) },
                { type: "Integer", value: String(expiryMs) },
                { type: "String", value: params.message },
                { type: "Integer", value: String(minNeo) },
                { type: "Integer", value: String(minHoldSeconds) },
                { type: "Integer", value: String(params.envelopeType ?? 0) },
              ],
            },
          ],
        }),
      );

      return res.txid;
    } finally {
      isLoading.value = false;
    }
  };

  /** Open a spreading (type=0) or claim (type=2) envelope NFT */
  const openEnvelope = async (envelope: EnvelopeItem): Promise<{ txid: string }> => {
    if (envelope.envelopeType === 1) {
      throw new Error("Use claimFromPool for pool envelopes");
    }
    if (envelope.envelopeType !== 0 && envelope.envelopeType !== 2) {
      throw new Error("Unsupported envelope type");
    }
    const operation = envelope.envelopeType === 2 ? "openClaim" : "openEnvelope";

    return assertTxResult(
      await invoke({
        scriptHash: CONTRACT_HASH,
        operation,
        args: [
          { type: "Integer", value: envelope.id },
          { type: "Hash160", value: address.value },
        ],
      }),
    );
  };

  /** Claim a slot from a pool envelope (type=1) — mints a claim NFT */
  const claimFromPool = async (poolId: string): Promise<{ txid: string }> => {
    claimLoading.value = true;
    try {
      return assertTxResult(
        await invoke({
          scriptHash: CONTRACT_HASH,
          operation: "claimFromPool",
          args: [
            { type: "Integer", value: poolId },
            { type: "Hash160", value: address.value },
          ],
        }),
      );
    } finally {
      claimLoading.value = false;
    }
  };

  /** Read exact amount claimed by current wallet from a pool envelope */
  const getPoolClaimedAmount = async (poolId: string): Promise<number> => {
    if (!address.value) throw new Error("Wallet not connected");
    const res = await invokeRead({
      scriptHash: CONTRACT_HASH,
      operation: "getPoolClaimedAmount",
      args: [
        { type: "Integer", value: poolId },
        { type: "Hash160", value: address.value },
      ],
    });

    const amount = Number(parseInvokeResult(res) ?? 0);
    return fromFixed8(amount);
  };

  /** Read exact amount opened by current wallet for spreading envelopes */
  const getOpenedAmount = async (envelopeId: string): Promise<number> => {
    if (!address.value) throw new Error("Wallet not connected");
    const res = await invokeRead({
      scriptHash: CONTRACT_HASH,
      operation: "getOpenedAmount",
      args: [
        { type: "Integer", value: envelopeId },
        { type: "Hash160", value: address.value },
      ],
    });

    const amount = Number(parseInvokeResult(res) ?? 0);
    return fromFixed8(amount);
  };

  /** Transfer spreading or claim envelope NFT */
  const transferEnvelope = async (envelope: EnvelopeItem, to: string): Promise<{ txid: string }> => {
    if (envelope.envelopeType === 1) {
      throw new Error("Pool envelopes cannot be transferred");
    }
    if (envelope.envelopeType !== 0 && envelope.envelopeType !== 2) {
      throw new Error("Unsupported envelope type");
    }

    const isClaim = envelope.envelopeType === 2;
    const operation = isClaim ? "transferClaim" : "transferEnvelope";
    const args = isClaim
      ? [
          { type: "Integer", value: envelope.id },
          { type: "Hash160", value: address.value },
          { type: "Hash160", value: to },
        ]
      : [
          { type: "Integer", value: envelope.id },
          { type: "Hash160", value: address.value },
          { type: "Hash160", value: to },
          { type: "Any", value: null },
        ];

    return assertTxResult(
      await invoke({
        scriptHash: CONTRACT_HASH,
        operation,
        args,
      }),
    );
  };

  /** Reclaim expired spreading envelope or pool GAS */
  const reclaimEnvelope = async (envelope: EnvelopeItem): Promise<{ txid: string }> => {
    if (envelope.envelopeType === 2) {
      throw new Error("Claim NFTs cannot be reclaimed directly; reclaim the parent pool");
    }
    if (envelope.envelopeType !== 0 && envelope.envelopeType !== 1) {
      throw new Error("Unsupported envelope type");
    }

    const operation = envelope.envelopeType === 1 ? "reclaimPool" : "reclaimEnvelope";

    return assertTxResult(
      await invoke({
        scriptHash: CONTRACT_HASH,
        operation,
        args: [
          { type: "Integer", value: envelope.id },
          { type: "Hash160", value: address.value },
        ],
      }),
    );
  };

  /**
   * Estimate reclaimable GAS for an expired pool:
   * pool.remainingAmount + all active/unopened claim NFT balances.
   */
  const getPoolReclaimableAmount = async (poolEnvelope: EnvelopeItem): Promise<number> => {
    if (poolEnvelope.envelopeType !== 1) {
      throw new Error("Only pool envelopes support pool reclaim estimation");
    }

    const poolData = await fetchEnvelopeMap(poolEnvelope.id);
    if (!poolData || Number(poolData.envelopeType ?? 0) !== 1) return 0;

    let reclaimable = parseIntegerLike(poolData.remainingAmount);
    const openedCount = Number(poolData.openedCount ?? 0);

    for (let i = 1; i <= openedCount; i++) {
      const claimIdRes = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "getPoolClaimIdByIndex",
        args: [
          { type: "Integer", value: poolEnvelope.id },
          { type: "Integer", value: String(i) },
        ],
      });
      const claimId = parseIntegerLike(parseInvokeResult(claimIdRes));
      if (claimId <= 0n) continue;

      const claimData = await fetchEnvelopeMap(claimId.toString());
      if (!claimData || Number(claimData.envelopeType ?? 0) !== 2) continue;

      const isActive = Boolean(claimData.active);
      const remaining = parseIntegerLike(claimData.remainingAmount);
      if (isActive && remaining > 0n) {
        reclaimable += remaining;
      }
    }

    const capped = reclaimable > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : reclaimable;
    return fromFixed8(Number(capped));
  };

  /** Fetch raw envelope map from contract */
  const fetchEnvelopeMap = async (envelopeId: string): Promise<Record<string, unknown> | null> => {
    const res = await invokeRead({
      scriptHash: CONTRACT_HASH,
      operation: "getEnvelopeState",
      args: [{ type: "Integer", value: envelopeId }],
    });
    const data = parseInvokeResult(res) as Record<string, unknown>;
    if (!data || !data.creator) return null;
    return data;
  };

  /** Fetch single envelope state from contract */
  const fetchEnvelopeState = async (envelopeId: string): Promise<EnvelopeItem | null> => {
    const data = await fetchEnvelopeMap(envelopeId);
    if (!data) return null;
    return mapEnvelopeData(envelopeId, data);
  };

  /** Fetch NFT tokenURI (data:application/json;base64,...) for sharing */
  const getTokenURI = async (tokenId: string): Promise<string> => {
    const res = await invokeRead({
      scriptHash: CONTRACT_HASH,
      operation: "tokenURI",
      args: [{ type: "Integer", value: tokenId }],
    });

    const parsed = parseInvokeResult(res);
    return typeof parsed === "string" ? parsed : "";
  };

  /** Load envelopes by scanning recent IDs */
  const loadEnvelopes = async () => {
    if (loadingEnvelopes.value) return; // prevent concurrent calls
    loadingEnvelopes.value = true;
    try {
      const countRes = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "getTotalEnvelopes",
        args: [],
      });
      const total = Number(parseInvokeResult(countRes) ?? 0);
      // Contract allocates IDs for claim NFTs too, so latest envelope ID can be
      // higher than getTotalEnvelopes(). Use storage fast-path and on-chain probing
      // fallback for browsers where getstorage is blocked (CORS/public RPC policy).
      const latestEnvelopeId = await getLatestEnvelopeIdFromStorage();
      const shouldProbeLatestId = typeof window !== "undefined" && latestEnvelopeId === 0 && total > 0;
      const upperBound = shouldProbeLatestId
        ? await resolveLatestEnvelopeId(total, latestEnvelopeId, async (envelopeId) => {
            try {
              return (await fetchEnvelopeMap(String(envelopeId))) !== null;
            } catch {
              return false;
            }
          })
        : Math.max(total, latestEnvelopeId);
      if (upperBound === 0) {
        envelopes.value = [];
        return;
      }

      const start = 1;
      const tasks: (() => Promise<EnvelopeItem | null>)[] = [];
      for (let i = upperBound; i >= start; i--) {
        const id = String(i);
        tasks.push(async () => {
          try {
            return await fetchEnvelopeState(id);
          } catch (err) {
            console.warn(`[RedEnvelope] failed to load envelope #${id}:`, err);
            return null;
          }
        });
      }
      const results = await pAll(tasks, 6);
      envelopes.value = results.filter(Boolean) as EnvelopeItem[];
    } catch (err) {
      console.warn("[RedEnvelope] loadEnvelopes failed:", err);
    } finally {
      loadingEnvelopes.value = false;
    }
  };

  return {
    isLoading,
    claimLoading,
    envelopes,
    loadingEnvelopes,
    createEnvelope,
    openEnvelope,
    claimFromPool,
    getPoolClaimedAmount,
    transferEnvelope,
    reclaimEnvelope,
    getPoolReclaimableAmount,
    getOpenedAmount,
    getTokenURI,
    fetchEnvelopeState,
    loadEnvelopes,
  };
}

function validate(amount: number, packets: number, expiryHours?: number, message?: string, minNeo?: number, minHoldDays?: number) {
  if (amount < MIN_AMOUNT) throw new Error("min 1 GAS");
  if (!Number.isInteger(packets)) throw new Error("packet count must be an integer");
  if (packets < 1 || packets > MAX_PACKETS) throw new Error("1-100 packets");
  if (amount < packets * MIN_PER_PACKET) throw new Error("min 0.1 GAS/packet");
  if (expiryHours !== undefined && !Number.isInteger(expiryHours)) throw new Error("expiry hours must be an integer");
  if (expiryHours !== undefined && expiryHours <= 0) throw new Error("expiry must be positive");
  if (minNeo !== undefined && !Number.isInteger(minNeo)) throw new Error("NEO gate values must be integers");
  if (minHoldDays !== undefined && !Number.isInteger(minHoldDays)) throw new Error("NEO gate values must be integers");
  if (minNeo !== undefined && minNeo < 0) throw new Error("NEO gate values cannot be negative");
  if (minHoldDays !== undefined && minHoldDays < 0) throw new Error("NEO gate values cannot be negative");
  if (message !== undefined && message.length > 256) throw new Error("message max 256 chars");
}

function mapEnvelopeData(id: string, d: Record<string, unknown>): EnvelopeItem {
  const envelopeType = Number(d.envelopeType ?? 0);
  const packetCount = Number(d.packetCount ?? 0);
  const openedCount = Number(d.openedCount ?? 0);
  const claimedCount = Number(d.claimedCount ?? openedCount);
  const active = Boolean(d.active);
  const expiryTime = Number(d.expiryTime ?? 0);
  const expired = Boolean(d.isExpired);
  const depleted = Boolean(d.isDepleted);

  const creator = normalizeScriptHashHex(d.creator) || String(d.creator ?? "");
  const currentHolder = normalizeScriptHashHex(d.currentHolder) || String(d.currentHolder ?? "");

  return {
    id,
    creator,
    envelopeType,
    parentEnvelopeId: String(d.parentEnvelopeId ?? "0"),
    totalAmount: fromFixed8(Number(d.totalAmount ?? 0)),
    packetCount,
    openedCount,
    claimedCount,
    remainingAmount: fromFixed8(Number(d.remainingAmount ?? 0)),
    remainingPackets: Number(d.remainingPackets ?? 0),
    minNeoRequired: Number(d.minNeoRequired ?? 0),
    minHoldSeconds: Number(d.minHoldSeconds ?? 0),
    active,
    expired,
    depleted,
    currentHolder,
    message: String(d.message ?? ""),
    expiryTime,
  };
}

function assertTxResult(res: unknown): { txid: string } {
  if (res && typeof res === "object" && "txid" in res) {
    return res as { txid: string };
  }
  throw new Error("Unexpected wallet response: missing txid");
}

function parseIntegerLike(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

async function getLatestEnvelopeIdFromStorage(): Promise<number> {
  if (typeof window === "undefined") return 0;
  try {
    const { defaultRpc } = resolveNetwork();
    const res = await fetch(defaultRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getstorage",
        params: [CONTRACT_HASH, ENVELOPE_ID_STORAGE_KEY_B64],
      }),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error || typeof json.result !== "string" || !json.result) return 0;

    const binary = atob(json.result);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (bytes.length === 0) return 0;

    // Neo storage integers are little-endian byte arrays.
    let value = 0n;
    for (let i = 0; i < bytes.length; i++) {
      value += BigInt(bytes[i]) << (BigInt(i) * 8n);
    }

    if (value <= 0n) return 0;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    return Number(value);
  } catch {
    return 0;
  }
}

async function resolveLatestEnvelopeId(
  totalEnvelopes: number,
  storageEnvelopeId: number,
  exists: (id: number) => Promise<boolean>,
): Promise<number> {
  let lowerBound = Math.max(totalEnvelopes, storageEnvelopeId);

  if (lowerBound <= 0) {
    if (!(await exists(1))) return 0;
    lowerBound = 1;
  } else if (!(await exists(lowerBound))) {
    // Defensive: if lower bound is stale, search downward for the last valid ID.
    let low = 0;
    let high = lowerBound;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (await exists(mid)) low = mid;
      else high = mid;
    }
    return low;
  }

  let low = lowerBound;
  let high = lowerBound;
  let foundMissingHigh = false;

  while (high < MAX_ENVELOPE_ID_PROBE) {
    const next = Math.min(MAX_ENVELOPE_ID_PROBE, Math.max(high + 1, high * 2));
    if (next === high) break;

    if (await exists(next)) {
      low = next;
      high = next;
      continue;
    }

    high = next;
    foundMissingHigh = true;
    break;
  }

  if (!foundMissingHigh) return high;

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (await exists(mid)) low = mid;
    else high = mid;
  }

  return low;
}
