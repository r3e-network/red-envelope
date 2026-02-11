import { ref } from "vue";
import { useWallet } from "./useWallet";
import { CONTRACT_HASH } from "@/config/contract";
import { parseInvokeResult } from "@/utils/neo";
import { fromFixed8 } from "@/utils/format";
import { pAll } from "@/utils/concurrency";

export type ClaimRecord = {
  claimId: string;
  holder: string;
  amount: number;
  /** Raw fixed8 integer amount — used for lossless accumulation */
  amountFixed8: number;
  opened: boolean;
  message: string;
};

export type HistoryData = {
  claims: ClaimRecord[];
  totalClaimed: number;
};

export function useEnvelopeHistory() {
  const { invokeRead } = useWallet();

  const loading = ref(false);
  const history = ref<HistoryData | null>(null);

  /** Fetch pool claim history by iterating claim indices */
  const fetchPoolHistory = async (poolId: string, claimCount: number): Promise<HistoryData> => {
    const claims: ClaimRecord[] = [];
    let totalClaimedFixed8 = 0;

    // Fetch claim IDs with bounded concurrency
    const idTasks: (() => Promise<string>)[] = [];
    for (let i = 1; i <= claimCount; i++) {
      const idx = i;
      idTasks.push(() => fetchPoolClaimId(poolId, idx));
    }
    const claimIds = await pAll(idTasks, 6);

    // Fetch claim states with bounded concurrency
    const stateTasks = claimIds.filter((id) => id !== "0").map((id) => () => fetchClaimState(id));
    const states = await pAll(stateTasks, 6);

    for (const state of states) {
      if (!state) continue;
      claims.push(state);
      // Accumulate raw fixed8 integers directly — no float round-trip
      totalClaimedFixed8 += state.amountFixed8;
    }

    return { claims, totalClaimed: fromFixed8(totalClaimedFixed8) };
  };

  /** Read a single pool claim ID by index */
  const fetchPoolClaimId = async (poolId: string, index: number): Promise<string> => {
    try {
      const res = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "getPoolClaimIdByIndex",
        args: [
          { type: "Integer", value: poolId },
          { type: "Integer", value: String(index) },
        ],
      });
      const val = parseInvokeResult(res);
      return String(val ?? "0");
    } catch {
      return "0";
    }
  };

  /** Read a single claim NFT state */
  const fetchClaimState = async (claimId: string): Promise<ClaimRecord | null> => {
    try {
      const res = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "getClaimState",
        args: [{ type: "Integer", value: claimId }],
      });
      const data = parseInvokeResult(res) as Record<string, unknown>;
      if (!data || !data.id) return null;

      const rawAmount = Number(data.amount ?? 0);
      return {
        claimId: String(data.id ?? claimId),
        holder: String(data.holder ?? ""),
        amount: fromFixed8(rawAmount),
        amountFixed8: rawAmount,
        opened: Boolean(data.opened),
        message: String(data.message ?? ""),
      };
    } catch {
      return null;
    }
  };

  /** Load history for a given envelope */
  const loadHistory = async (envelopeId: string, envelopeType: number, claimCount: number) => {
    loading.value = true;
    history.value = null;

    try {
      if (envelopeType === 1 && claimCount > 0) {
        // Pool type: fetch all claim records
        history.value = await fetchPoolHistory(envelopeId, claimCount);
      }
      // Spreading (type 0) and Claim (type 2) don't have sub-claims
      // Their state is shown via EnvelopeDetail (currentHolder, etc.)
    } catch (err) {
      console.warn("[EnvelopeHistory] loadHistory failed:", err);
    } finally {
      loading.value = false;
    }
  };

  const clearHistory = () => {
    history.value = null;
  };

  return { loading, history, loadHistory, clearHistory };
}
