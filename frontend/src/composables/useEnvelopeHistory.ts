import { ref } from "vue";
import { useWallet } from "./useWallet";
import { CONTRACT_HASH } from "@/config/contract";
import { parseInvokeResult } from "@/utils/neo";
import { fromFixed8 } from "@/utils/format";

export type ClaimRecord = {
  claimId: string;
  holder: string;
  amount: number;
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
  const fetchPoolHistory = async (poolId: string, openedCount: number): Promise<HistoryData> => {
    const claims: ClaimRecord[] = [];
    let totalClaimed = 0;

    // Fetch claim IDs in parallel (batched)
    const claimIdPromises: Promise<string>[] = [];
    for (let i = 1; i <= openedCount; i++) {
      claimIdPromises.push(fetchPoolClaimId(poolId, i));
    }
    const claimIds = await Promise.all(claimIdPromises);

    // Fetch claim states in parallel
    const statePromises = claimIds.filter((id) => id !== "0").map((id) => fetchClaimState(id));
    const states = await Promise.all(statePromises);

    for (const state of states) {
      if (!state) continue;
      claims.push(state);
      totalClaimed += state.amount;
    }

    return { claims, totalClaimed };
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

      return {
        claimId: String(data.id ?? claimId),
        holder: String(data.holder ?? ""),
        amount: fromFixed8(Number(data.amount ?? 0)),
        opened: Boolean(data.opened),
        message: String(data.message ?? ""),
      };
    } catch {
      return null;
    }
  };

  /** Load history for a given envelope */
  const loadHistory = async (envelopeId: string, envelopeType: number, openedCount: number) => {
    loading.value = true;
    history.value = null;

    try {
      if (envelopeType === 1 && openedCount > 0) {
        // Pool type: fetch all claim records
        history.value = await fetchPoolHistory(envelopeId, openedCount);
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
