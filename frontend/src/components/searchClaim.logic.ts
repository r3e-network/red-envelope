export function mapWalletConnectError(
  err: unknown,
  t: (key: "walletNotDetected") => string,
): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("No Neo wallet") ? t("walletNotDetected") : msg;
}
