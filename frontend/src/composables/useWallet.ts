import { ref } from "vue";
import { addressToScriptHashHex } from "@/utils/neo";

const address = ref("");
const connected = ref(false);

/** Map dAPI string scopes → NeoLine numeric WitnessScope */
function neolineScope(scopes: unknown): number {
  if (typeof scopes === "number") return scopes;
  switch (String(scopes)) {
    case "None":
      return 0;
    case "CalledByEntry":
      return 1;
    case "CustomContracts":
      return 16;
    case "CustomGroups":
      return 32;
    case "Global":
      return 128;
    default:
      return 1;
  }
}

/** Convert N-address → 0x-prefixed script hash; pass through hashes unchanged */
function toScriptHash(value: string): string {
  if (!value) return value;
  if (value.startsWith("0x") || /^[0-9a-fA-F]{40}$/.test(value)) return value;
  // N-address → 0x-prefixed little-endian hex
  return addressToScriptHashHex(value) || value;
}

/** Strip 0x prefix (NeoLine signers need bare hex) */
function toBareHex(value: string): string {
  const h = toScriptHash(value);
  return h.startsWith("0x") ? h.slice(2) : h;
}

/**
 * Recursively convert Hash160 arg values from N-address to script hash.
 * NeoLine's direct invoke() doesn't auto-convert like OneGate's request().
 */
function neolineArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (!arg || typeof arg !== "object") return arg;
    const a = arg as Record<string, unknown>;
    if (a.type === "Hash160" && typeof a.value === "string") {
      return { ...a, value: toScriptHash(a.value) };
    }
    if (a.type === "Array" && Array.isArray(a.value)) {
      return { ...a, value: neolineArgs(a.value) };
    }
    return arg;
  });
}

/** Wrap NeoLine N3 direct-method API into the unified request() pattern */
function wrapNeoLine(nl: NeoLineN3Instance): NeoDapi {
  return {
    async request(p: { method: string; params?: Record<string, unknown> }): Promise<unknown> {
      switch (p.method) {
        case "getAccount":
          return nl.getAccount();
        case "invoke": {
          const params = { ...(p.params ?? {}) };
          // Convert Hash160 args: N-address → script hash
          if (Array.isArray(params.args)) {
            params.args = neolineArgs(params.args as unknown[]);
          }
          // Convert signers: bare-hex account + numeric scopes
          if (Array.isArray(params.signers)) {
            params.signers = (params.signers as Array<Record<string, unknown>>).map((s) => ({
              ...s,
              account: toBareHex(String(s.account ?? "")),
              scopes: neolineScope(s.scopes),
            }));
          }
          return nl.invoke(params);
        }
        case "invokeRead": {
          const rParams = { ...(p.params ?? {}) };
          if (Array.isArray(rParams.args)) {
            rParams.args = neolineArgs(rParams.args as unknown[]);
          }
          return nl.invokeRead(rParams);
        }
        case "getBalance":
          return nl.getBalance(p.params ?? {});
        default:
          throw new Error(`Unsupported method: ${p.method}`);
      }
    },
  };
}

/** Try to get a NeoLine N3 instance */
function getNeoLineInstance(): NeoLineN3Instance | null {
  const ctor = window.NEOLineN3 ?? window.NEOLine?.N3;
  if (!ctor) return null;
  try {
    return new ctor.Init();
  } catch {
    return null;
  }
}

function getDapi(): NeoDapi | null {
  // Priority: OneGate > generic neo > NeoLine N3
  if (window.OneGate) return window.OneGate;
  if (window.neo) return window.neo;
  const nl = getNeoLineInstance();
  if (nl) return wrapNeoLine(nl);
  return null;
}

/** Wait up to ~2s for wallet extension to inject (async injection) */
function waitForDapi(timeoutMs = 2000): Promise<NeoDapi | null> {
  const dapi = getDapi();
  if (dapi) return Promise.resolve(dapi);

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      clearInterval(interval);
      window.removeEventListener("NEOLine.NEO.EVENT.READY", onReady);
    };

    // NeoLine fires this event when ready
    const onReady = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(getDapi());
    };
    window.addEventListener("NEOLine.NEO.EVENT.READY", onReady);

    // Fallback: poll every 200ms
    const interval = setInterval(() => {
      const d = getDapi();
      if (d) {
        resolved = true;
        cleanup();
        resolve(d);
      }
    }, 200);

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(getDapi());
      }
    }, timeoutMs);
  });
}

export function useWallet() {
  const connect = async (): Promise<string> => {
    const dapi = await waitForDapi();
    if (!dapi) throw new Error("No Neo wallet detected");

    const res = (await dapi.request({ method: "getAccount" })) as {
      address: string;
    };
    address.value = res.address;
    connected.value = true;
    return res.address;
  };

  const invoke = async (params: {
    scriptHash: string;
    operation: string;
    args?: unknown[];
    signers?: unknown[];
  }): Promise<unknown> => {
    const dapi = await waitForDapi();
    if (!dapi) throw new Error("No Neo wallet detected");
    if (!connected.value || !address.value) {
      await connect();
    }

    return dapi.request({
      method: "invoke",
      params: {
        scriptHash: params.scriptHash,
        operation: params.operation,
        args: params.args ?? [],
        signers: params.signers ?? [{ account: address.value, scopes: "CalledByEntry" }],
      },
    });
  };

  const invokeRead = async (params: { scriptHash: string; operation: string; args?: unknown[] }): Promise<unknown> => {
    const dapi = await waitForDapi();
    if (!dapi) throw new Error("No Neo wallet detected");

    return dapi.request({
      method: "invokeRead",
      params: {
        scriptHash: params.scriptHash,
        operation: params.operation,
        args: params.args ?? [],
        signers: [],
      },
    });
  };

  const getBalance = async (asset: string): Promise<string> => {
    const dapi = await waitForDapi();
    if (!dapi) return "0";
    if (!connected.value || !address.value) {
      try {
        await connect();
      } catch {
        return "0";
      }
    }

    const res = (await dapi.request({
      method: "getBalance",
      params: { address: address.value, contracts: [asset] },
    })) as { balance: string }[];

    return res?.[0]?.balance ?? "0";
  };

  /** Auto-connect once a dapi provider is available (waits for async injection) */
  const autoConnect = async (): Promise<void> => {
    if (connected.value) return;
    const dapi = await waitForDapi();
    if (!dapi) return;
    try {
      await connect();
    } catch (e) {
      console.debug("[Wallet] autoConnect skipped:", e);
    }
  };

  return { address, connected, connect, autoConnect, invoke, invokeRead, getBalance };
}

// ── Singleton event listeners (registered once at module load) ──
let _listenersRegistered = false;
function _registerWalletListeners() {
  if (_listenersRegistered || typeof window === "undefined") return;
  _listenersRegistered = true;

  window.addEventListener("NEOLine.NEO.EVENT.ACCOUNT_CHANGED", async () => {
    const dapi = await waitForDapi();
    if (dapi) {
      try {
        const res = (await dapi.request({ method: "getAccount" })) as { address: string };
        if (res?.address) {
          address.value = res.address;
        }
      } catch {
        // Wallet may have disconnected mid-event
      }
    }
  });
  window.addEventListener("NEOLine.NEO.EVENT.DISCONNECTED", () => {
    address.value = "";
    connected.value = false;
  });
}
_registerWalletListeners();
