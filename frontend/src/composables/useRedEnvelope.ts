import { ref } from "vue";
import { useWallet } from "./useWallet";
import { CONTRACT_HASH } from "@/config/contract";
import { fromFixed8, toFixed8 } from "@/utils/format";
import { parseInvokeResult } from "@/utils/neo";

export const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";

export const MIN_AMOUNT = 10_000_000; // 0.1 GAS fixed8
export const MAX_PACKETS = 100;
export const MIN_PER_PACKET = 1_000_000; // 0.01 GAS fixed8

export type EnvelopeItem = {
  id: string;
  creator: string;
  envelopeType: number;
  parentEnvelopeId: string;
  totalAmount: number;
  packetCount: number;
  openedCount: number;
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
  }): Promise<string> => {
    isLoading.value = true;
    try {
      const amount = toFixed8(params.totalGas);
      validate(amount, params.packetCount, params.expiryHours, params.message);

      const expirySeconds = params.expiryHours * 3600;
      const minHoldSeconds = params.minHoldDays * 86400;

      // Send GAS to contract with config data array
      const res = (await invoke({
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
              { type: "Integer", value: String(expirySeconds) },
              { type: "String", value: params.message },
              { type: "Integer", value: String(params.minNeo) },
              { type: "Integer", value: String(minHoldSeconds) },
              { type: "Integer", value: "0" }, // envelopeType: spreading
            ],
          },
        ],
      })) as { txid: string };

      return res.txid;
    } finally {
      isLoading.value = false;
    }
  };

  /** Open a spreading or claim envelope (caller must be NFT holder) */
  const openEnvelope = async (envelope: EnvelopeItem): Promise<{ txid: string }> => {
    const operation = envelope.envelopeType === 2 ? "openClaim" : "openEnvelope";

    return (await invoke({
      scriptHash: CONTRACT_HASH,
      operation,
      args: [
        { type: "Integer", value: envelope.id },
        { type: "Hash160", value: address.value },
      ],
    })) as { txid: string };
  };

  /** Read exact amount opened by current wallet for spreading envelopes */
  const getOpenedAmount = async (envelopeId: string): Promise<number> => {
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

    return (await invoke({
      scriptHash: CONTRACT_HASH,
      operation,
      args,
    })) as { txid: string };
  };

  /** Reclaim expired spreading envelope or pool GAS */
  const reclaimEnvelope = async (envelope: EnvelopeItem): Promise<{ txid: string }> => {
    const operation = envelope.envelopeType === 1 ? "reclaimPool" : "reclaimEnvelope";

    return (await invoke({
      scriptHash: CONTRACT_HASH,
      operation,
      args: [
        { type: "Integer", value: envelope.id },
        { type: "Hash160", value: address.value },
      ],
    })) as { txid: string };
  };

  /** Fetch single envelope state from contract */
  const fetchEnvelopeState = async (envelopeId: string): Promise<EnvelopeItem | null> => {
    try {
      const res = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "getEnvelopeState",
        args: [{ type: "Integer", value: envelopeId }],
      });
      const data = parseInvokeResult(res) as Record<string, unknown>;
      if (!data || !data.creator) return null;
      return mapEnvelopeData(envelopeId, data);
    } catch {
      return null;
    }
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
      if (total === 0) {
        envelopes.value = [];
        return;
      }

      const start = Math.max(1, total - 24);
      const promises: Promise<EnvelopeItem | null>[] = [];
      for (let i = total; i >= start; i--) {
        promises.push(fetchEnvelopeState(String(i)));
      }
      const results = await Promise.all(promises);
      envelopes.value = results.filter(Boolean) as EnvelopeItem[];
    } catch (err) {
      console.warn("[RedEnvelope] loadEnvelopes failed:", err);
    } finally {
      loadingEnvelopes.value = false;
    }
  };

  return {
    isLoading,
    envelopes,
    loadingEnvelopes,
    createEnvelope,
    openEnvelope,
    transferEnvelope,
    reclaimEnvelope,
    getOpenedAmount,
    fetchEnvelopeState,
    loadEnvelopes,
  };
}

function validate(amount: number, packets: number, expiryHours?: number, message?: string) {
  if (amount < MIN_AMOUNT) throw new Error("min 0.1 GAS");
  if (packets < 1 || packets > MAX_PACKETS) throw new Error("1-100 packets");
  if (amount < packets * MIN_PER_PACKET) throw new Error("min 0.01 GAS/packet");
  if (expiryHours !== undefined && expiryHours <= 0) throw new Error("expiry must be positive");
  if (message !== undefined && message.length > 256) throw new Error("message max 256 chars");
}

function mapEnvelopeData(id: string, d: Record<string, unknown>): EnvelopeItem {
  const envelopeType = Number(d.envelopeType ?? 0);
  const packetCount = Number(d.packetCount ?? 0);
  const openedCount = Number(d.openedCount ?? 0);
  const active = Boolean(d.active);
  const expiryTime = Number(d.expiryTime ?? 0);
  const currentTime = Number(d.currentTime ?? 0);
  const expired = expiryTime > 0 && currentTime > expiryTime;
  const depleted = Boolean(d.isDepleted) || openedCount >= packetCount;

  return {
    id,
    creator: String(d.creator ?? ""),
    envelopeType,
    parentEnvelopeId: String(d.parentEnvelopeId ?? "0"),
    totalAmount: fromFixed8(Number(d.totalAmount ?? 0)),
    packetCount,
    openedCount,
    remainingAmount: fromFixed8(Number(d.remainingAmount ?? 0)),
    remainingPackets: Math.max(0, packetCount - openedCount),
    minNeoRequired: Number(d.minNeoRequired ?? 0),
    minHoldSeconds: Number(d.minHoldSeconds ?? 0),
    active,
    expired,
    depleted,
    currentHolder: String(d.currentHolder ?? ""),
    message: String(d.message ?? ""),
    expiryTime,
  };
}
