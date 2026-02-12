import { resolveNetwork } from "@/config/networks";

const POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Poll the RPC node until a transaction's application log is available,
 * meaning the TX has been included in a confirmed block.
 */
export async function waitForConfirmation(txid: string, maxWaitMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const { defaultRpc } = resolveNetwork();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(defaultRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getapplicationlog",
          params: [txid],
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      if (json.result && !json.error) {
        // Check for VM FAULT — TX confirmed but execution failed
        const executions = (json.result as Record<string, unknown>).executions as
          | Array<{ vmstate?: string; exception?: string }>
          | undefined;
        if (executions?.[0]?.vmstate === "FAULT") {
          throw new Error(`Transaction FAULT: ${executions[0].exception ?? "unknown"}`);
        }
        return;
      }
    } catch (e) {
      // Re-throw VM FAULT errors immediately — don't retry a confirmed failure
      if (e instanceof Error && e.message.startsWith("Transaction FAULT")) throw e;
      // RPC call failed (network error, not yet confirmed) — retry
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout — proceed anyway (state refresh will show stale data but won't crash)
  console.warn(`[rpc] TX confirmation timeout after ${maxWaitMs}ms: ${txid}`);
}
