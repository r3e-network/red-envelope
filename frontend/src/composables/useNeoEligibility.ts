import { ref } from "vue";
import { useWallet } from "./useWallet";
import { CONTRACT_HASH } from "@/config/contract";
import { parseInvokeResult } from "@/utils/neo";

export type EligibilityResult = {
  eligible: boolean;
  reason: string;
  neoBalance: number;
  holdDays: number;
  minNeoRequired: number;
  minHoldSeconds: number;
};

function failedResult(reason: string): EligibilityResult {
  return { eligible: false, reason, neoBalance: 0, holdDays: 0, minNeoRequired: 0, minHoldSeconds: 0 };
}

export function useNeoEligibility() {
  const { address, connected, invokeRead } = useWallet();

  const checking = ref(false);
  const result = ref<EligibilityResult | null>(null);

  const parseEligibility = (raw: unknown): EligibilityResult => {
    const data = parseInvokeResult(raw) as Record<string, unknown>;
    return {
      eligible: Boolean(data?.eligible),
      reason: String(data?.reason ?? "unknown"),
      neoBalance: Number(data?.neoBalance ?? 0),
      holdDays: Number(data?.holdDays ?? 0),
      minNeoRequired: Number(data?.minNeoRequired ?? 0),
      minHoldSeconds: Number(data?.minHoldSeconds ?? 0),
    };
  };

  const checkEligibilityForAddress = async (envelopeId: string, targetAddress: string): Promise<EligibilityResult> => {
    checking.value = true;
    try {
      const res = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "checkEligibility",
        args: [
          { type: "Integer", value: envelopeId },
          { type: "Hash160", value: targetAddress },
        ],
      });

      const r = parseEligibility(res);
      result.value = r;
      return r;
    } catch (err) {
      const r = failedResult(err instanceof Error ? err.message : "check failed");
      result.value = r;
      return r;
    } finally {
      checking.value = false;
    }
  };

  const checkEligibility = async (envelopeId: string): Promise<EligibilityResult> => {
    checking.value = true;
    try {
      if (!connected.value || !address.value) {
        const r = failedResult("wallet not connected");
        result.value = r;
        return r;
      }

      const res = await invokeRead({
        scriptHash: CONTRACT_HASH,
        operation: "checkEligibility",
        args: [
          { type: "Integer", value: envelopeId },
          { type: "Hash160", value: address.value },
        ],
      });
      const r = parseEligibility(res);
      result.value = r;
      return r;
    } catch (err) {
      const r = failedResult(err instanceof Error ? err.message : "check failed");
      result.value = r;
      return r;
    } finally {
      checking.value = false;
    }
  };

  return { checking, result, checkEligibility, checkEligibilityForAddress };
}
