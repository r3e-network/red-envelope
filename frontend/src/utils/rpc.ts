import { resolveNetwork } from "@/config/networks";

const POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export type RpcNotification = {
  contract?: string;
  eventname?: string;
  state?: unknown;
};

export type RpcExecution = {
  vmstate?: string;
  exception?: string;
  notifications?: RpcNotification[];
};

export type RpcApplicationLog = {
  executions?: RpcExecution[];
};

async function getApplicationLog(txid: string): Promise<RpcApplicationLog | null> {
  const { defaultRpc } = resolveNetwork();
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
  if (!res.ok) return null;

  const json = (await res.json()) as { result?: RpcApplicationLog; error?: unknown };
  if (json.error || !json.result) return null;
  return json.result;
}

function normalizeHash(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
}

function readArrayItemAsIntegerString(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (String(item.type) !== "Integer") return null;
  const raw = item.value;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  return null;
}

/** Extract envelope id from EnvelopeCreated notification state */
export function extractEnvelopeCreatedId(appLog: RpcApplicationLog | null, contractHash?: string): string | null {
  if (!appLog?.executions?.length) return null;
  const contract = contractHash ? normalizeHash(contractHash) : "";

  for (const execution of appLog.executions) {
    const notifications = execution.notifications ?? [];
    for (const notification of notifications) {
      if (notification.eventname !== "EnvelopeCreated") continue;
      if (contract && notification.contract && normalizeHash(notification.contract) !== contract) continue;

      const state = notification.state as Record<string, unknown> | undefined;
      const items =
        state && String(state.type) === "Array" && Array.isArray(state.value)
          ? (state.value as unknown[])
          : [];
      if (items.length === 0) continue;

      const id = readArrayItemAsIntegerString(items[0]);
      if (!id) continue;
      try {
        if (BigInt(id) > 0n) return id;
      } catch {
        // ignore malformed id
      }
    }
  }

  return null;
}

/**
 * Poll the RPC node until a transaction's application log is available,
 * meaning the TX has been included in a confirmed block.
 */
export async function waitForConfirmation(txid: string, maxWaitMs = DEFAULT_TIMEOUT_MS): Promise<RpcApplicationLog | null> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const log = await getApplicationLog(txid);
      if (log) {
        // Check for VM FAULT — TX confirmed but execution failed
        const executions = log.executions;
        if (executions?.[0]?.vmstate === "FAULT") {
          throw new Error(`Transaction FAULT: ${executions[0].exception ?? "unknown"}`);
        }
        return log;
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
  return null;
}
