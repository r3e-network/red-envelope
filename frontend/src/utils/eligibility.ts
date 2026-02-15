import type { MessageKey } from "@/locale/messages";

type Translator = (key: MessageKey, ...args: Array<string | number>) => string;

export function mapEligibilityReason(reason: string, t: Translator): string {
  switch (reason) {
    case "insufficient NEO":
      return t("insufficientNeo");
    case "hold duration not met":
    case "no NEO state":
      return t("holdNotMet");
    case "already opened":
      return t("alreadyOpenedByYou");
    case "already claimed":
      return t("alreadyClaimedPool");
    case "expired":
      return t("expired");
    case "depleted":
      return t("depleted");
    case "not active":
      return t("eligibilityNotActive");
    case "not NFT holder":
      return t("eligibilityNotHolder");
    case "contracts cannot open/claim":
      return t("eligibilityContractBlocked");
    case "envelope not found":
    case "token not found":
      return t("notFound");
    case "wallet not connected":
      return t("connectWallet");
    default:
      return reason || t("eligibilityCheckFailed");
  }
}
