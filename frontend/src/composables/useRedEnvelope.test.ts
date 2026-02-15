import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInvoke = vi.fn();
const mockInvokeRead = vi.fn();

vi.mock("./useWallet", () => {
  return {
    useWallet: () => ({
      address: { value: "NXV7ZhHiyM1aHXwpVsRZC6BwNFP2jghXAq" },
      invoke: mockInvoke,
      invokeRead: mockInvokeRead,
    }),
  };
});

import { useRedEnvelope } from "./useRedEnvelope";

type StackItem =
  | { type: "Integer"; value: string }
  | { type: "Boolean"; value: boolean }
  | { type: "String"; value: string }
  | { type: "Hash160"; value: string }
  | { type: "ByteString"; value: string }
  | { type: "Map"; value: Array<{ key: StackItem; value: StackItem }> };

function mapStack(values: Record<string, StackItem>): { stack: StackItem[] } {
  return {
    stack: [
      {
        type: "Map",
        value: Object.entries(values).map(([k, v]) => ({
          key: { type: "String", value: k },
          value: v,
        })),
      },
    ],
  };
}

describe("useRedEnvelope", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvokeRead.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads all envelopes instead of truncating to the latest 50", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "60" }] };
      }
      if (req.operation === "getEnvelopeState") {
        const id = String(req.args?.[0]?.value ?? "0");
        return mapStack({
          creator: { type: "String", value: `0xcreator${id}` },
          envelopeType: { type: "Integer", value: "0" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "100000000" },
          packetCount: { type: "Integer", value: "1" },
          openedCount: { type: "Integer", value: "0" },
          claimedCount: { type: "Integer", value: "0" },
          remainingAmount: { type: "Integer", value: "100000000" },
          remainingPackets: { type: "Integer", value: "1" },
          minNeoRequired: { type: "Integer", value: "1" },
          minHoldSeconds: { type: "Integer", value: "1" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "String", value: "0xholder" },
          message: { type: "String", value: `env-${id}` },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }

      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await api.loadEnvelopes();

    expect(api.envelopes.value).toHaveLength(60);
  });

  it("loads envelopes up to latest allocated ID when it is higher than total envelopes", async () => {
    vi.stubGlobal("window", {} as Window);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: "Eg==" }), // 0x12 => latest allocated ID 18
      }),
    );

    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "13" }] };
      }
      if (req.operation === "getEnvelopeState") {
        const id = String(req.args?.[0]?.value ?? "0");
        return mapStack({
          creator: { type: "String", value: `0xcreator${id}` },
          envelopeType: { type: "Integer", value: Number(id) >= 16 ? "2" : "0" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "100000000" },
          packetCount: { type: "Integer", value: "1" },
          openedCount: { type: "Integer", value: "0" },
          claimedCount: { type: "Integer", value: "0" },
          remainingAmount: { type: "Integer", value: "100000000" },
          remainingPackets: { type: "Integer", value: "1" },
          minNeoRequired: { type: "Integer", value: "0" },
          minHoldSeconds: { type: "Integer", value: "0" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "String", value: "0xholder" },
          message: { type: "String", value: `env-${id}` },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }

      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await api.loadEnvelopes();

    expect(api.envelopes.value).toHaveLength(18);
    expect(api.envelopes.value[0].id).toBe("18");
    expect(api.envelopes.value[17].id).toBe("1");
  });

  it("discovers latest envelope ID by probing when storage lookup is unavailable", async () => {
    vi.stubGlobal("window", {} as Window);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("storage blocked")));

    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "13" }] };
      }
      if (req.operation === "getEnvelopeState") {
        const id = Number(req.args?.[0]?.value ?? "0");
        if (id <= 0 || id > 27) {
          return { stack: [{ type: "Map", value: [] }] };
        }
        return mapStack({
          creator: { type: "String", value: `0xcreator${id}` },
          envelopeType: { type: "Integer", value: id >= 20 ? "2" : "1" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "100000000" },
          packetCount: { type: "Integer", value: "1" },
          openedCount: { type: "Integer", value: "0" },
          claimedCount: { type: "Integer", value: "0" },
          remainingAmount: { type: "Integer", value: "100000000" },
          remainingPackets: { type: "Integer", value: "1" },
          minNeoRequired: { type: "Integer", value: "0" },
          minHoldSeconds: { type: "Integer", value: "0" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "String", value: "0xholder" },
          message: { type: "String", value: `env-${id}` },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }

      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await api.loadEnvelopes();

    expect(api.envelopes.value).toHaveLength(27);
    expect(api.envelopes.value[0].id).toBe("27");
    expect(api.envelopes.value[26].id).toBe("1");
  });

  it("includes claim NFTs when loading envelopes", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "2" }] };
      }
      if (req.operation === "getEnvelopeState") {
        const id = req.args?.[0]?.value;
        if (id === "2") {
          return mapStack({
            creator: { type: "String", value: "0xcreator" },
            envelopeType: { type: "Integer", value: "2" },
            parentEnvelopeId: { type: "Integer", value: "1" },
            totalAmount: { type: "Integer", value: "100000000" },
            packetCount: { type: "Integer", value: "1" },
            openedCount: { type: "Integer", value: "0" },
            claimedCount: { type: "Integer", value: "0" },
            remainingAmount: { type: "Integer", value: "100000000" },
            remainingPackets: { type: "Integer", value: "1" },
            minNeoRequired: { type: "Integer", value: "1" },
            minHoldSeconds: { type: "Integer", value: "1" },
            active: { type: "Boolean", value: true },
            isExpired: { type: "Boolean", value: false },
            isDepleted: { type: "Boolean", value: false },
            currentHolder: { type: "String", value: "0xholder" },
            message: { type: "String", value: "claim" },
            expiryTime: { type: "Integer", value: "9999999999" },
          });
        }

        return mapStack({
          creator: { type: "String", value: "0xcreator" },
          envelopeType: { type: "Integer", value: "1" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "200000000" },
          packetCount: { type: "Integer", value: "2" },
          openedCount: { type: "Integer", value: "1" },
          claimedCount: { type: "Integer", value: "1" },
          remainingAmount: { type: "Integer", value: "100000000" },
          remainingPackets: { type: "Integer", value: "1" },
          minNeoRequired: { type: "Integer", value: "1" },
          minHoldSeconds: { type: "Integer", value: "1" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "String", value: "0x0000000000000000000000000000000000000000" },
          message: { type: "String", value: "pool" },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }

      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await api.loadEnvelopes();

    expect(api.envelopes.value.some((e) => e.envelopeType === 2)).toBe(true);
  });

  it("normalizes creator/currentHolder hashes returned in Hash160 and bare-hex forms", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string }) => {
      if (req.operation === "getEnvelopeState") {
        return mapStack({
          creator: { type: "Hash160", value: "A5DE523AE9D99BE784A536E9412B7A3CBE049E1A" },
          envelopeType: { type: "Integer", value: "1" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "200000000" },
          packetCount: { type: "Integer", value: "2" },
          openedCount: { type: "Integer", value: "0" },
          claimedCount: { type: "Integer", value: "0" },
          remainingAmount: { type: "Integer", value: "200000000" },
          remainingPackets: { type: "Integer", value: "2" },
          minNeoRequired: { type: "Integer", value: "0" },
          minHoldSeconds: { type: "Integer", value: "0" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "Hash160", value: "0000000000000000000000000000000000000000" },
          message: { type: "String", value: "pool" },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }
      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    const state = await api.fetchEnvelopeState("99");
    expect(state).toBeTruthy();
    expect(state?.creator).toBe("0xa5de523ae9d99be784a536e9412b7a3cbe049e1a");
    expect(state?.currentHolder).toBe("0x0000000000000000000000000000000000000000");
  });

  it("exposes exact pool claimed amount for current wallet", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string }) => {
      if (req.operation === "getPoolClaimedAmount") {
        return { stack: [{ type: "Integer", value: "123000000" }] };
      }
      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope() as unknown as {
      getPoolClaimedAmount?: (poolId: string) => Promise<number>;
    };

    expect(typeof api.getPoolClaimedAmount).toBe("function");
    const claimed = await api.getPoolClaimedAmount!("1");
    expect(claimed).toBe(1.23);
  });

  it("estimates pool reclaimable amount including active claim NFTs", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getEnvelopeState") {
        const id = req.args?.[0]?.value;
        if (id === "10") {
          return mapStack({
            creator: { type: "String", value: "0xcreator" },
            envelopeType: { type: "Integer", value: "1" },
            parentEnvelopeId: { type: "Integer", value: "0" },
            totalAmount: { type: "Integer", value: "200000000" },
            packetCount: { type: "Integer", value: "2" },
            openedCount: { type: "Integer", value: "2" },
            claimedCount: { type: "Integer", value: "2" },
            remainingAmount: { type: "Integer", value: "100000000" },
            remainingPackets: { type: "Integer", value: "0" },
            minNeoRequired: { type: "Integer", value: "0" },
            minHoldSeconds: { type: "Integer", value: "0" },
            active: { type: "Boolean", value: true },
            isExpired: { type: "Boolean", value: true },
            isDepleted: { type: "Boolean", value: true },
            currentHolder: { type: "String", value: "0x0000000000000000000000000000000000000000" },
            message: { type: "String", value: "pool" },
            expiryTime: { type: "Integer", value: "9999999999" },
          });
        }
        if (id === "11") {
          return mapStack({
            creator: { type: "String", value: "0xcreator" },
            envelopeType: { type: "Integer", value: "2" },
            parentEnvelopeId: { type: "Integer", value: "10" },
            totalAmount: { type: "Integer", value: "50000000" },
            packetCount: { type: "Integer", value: "1" },
            openedCount: { type: "Integer", value: "0" },
            claimedCount: { type: "Integer", value: "0" },
            remainingAmount: { type: "Integer", value: "50000000" },
            remainingPackets: { type: "Integer", value: "1" },
            minNeoRequired: { type: "Integer", value: "0" },
            minHoldSeconds: { type: "Integer", value: "0" },
            active: { type: "Boolean", value: true },
            isExpired: { type: "Boolean", value: true },
            isDepleted: { type: "Boolean", value: false },
            currentHolder: { type: "String", value: "0xholder" },
            message: { type: "String", value: "claim-active" },
            expiryTime: { type: "Integer", value: "9999999999" },
          });
        }
        if (id === "12") {
          return mapStack({
            creator: { type: "String", value: "0xcreator" },
            envelopeType: { type: "Integer", value: "2" },
            parentEnvelopeId: { type: "Integer", value: "10" },
            totalAmount: { type: "Integer", value: "70000000" },
            packetCount: { type: "Integer", value: "1" },
            openedCount: { type: "Integer", value: "1" },
            claimedCount: { type: "Integer", value: "1" },
            remainingAmount: { type: "Integer", value: "70000000" },
            remainingPackets: { type: "Integer", value: "0" },
            minNeoRequired: { type: "Integer", value: "0" },
            minHoldSeconds: { type: "Integer", value: "0" },
            active: { type: "Boolean", value: false },
            isExpired: { type: "Boolean", value: true },
            isDepleted: { type: "Boolean", value: true },
            currentHolder: { type: "String", value: "0xholder" },
            message: { type: "String", value: "claim-opened" },
            expiryTime: { type: "Integer", value: "9999999999" },
          });
        }
      }

      if (req.operation === "getPoolClaimIdByIndex") {
        const index = req.args?.[1]?.value;
        if (index === "1") return { stack: [{ type: "Integer", value: "11" }] };
        if (index === "2") return { stack: [{ type: "Integer", value: "12" }] };
        return { stack: [{ type: "Integer", value: "0" }] };
      }

      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope() as unknown as {
      getPoolReclaimableAmount?: (poolEnvelope: { id: string; envelopeType: number }) => Promise<number>;
    };

    expect(typeof api.getPoolReclaimableAmount).toBe("function");
    const amount = await api.getPoolReclaimableAmount!({ id: "10", envelopeType: 1 });
    expect(amount).toBe(1.5);
  });

  it("propagates fetchEnvelopeState read errors to caller", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string }) => {
      if (req.operation === "getEnvelopeState") {
        throw new Error("rpc down");
      }
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "0" }] };
      }
      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await expect(api.fetchEnvelopeState("1")).rejects.toThrow("rpc down");
  });

  it("rejects non-integer packetCount when creating envelope", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();

    await expect(
      api.createEnvelope({
        totalGas: 10,
        packetCount: 1.5,
        expiryHours: 24,
        message: "test",
        minNeo: 100,
        minHoldDays: 2,
        envelopeType: 1,
      }),
    ).rejects.toThrow("packet count must be an integer");
  });

  it("rejects non-integer NEO gate values when creating envelope", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();

    await expect(
      api.createEnvelope({
        totalGas: 10,
        packetCount: 2,
        expiryHours: 24,
        message: "test",
        minNeo: 0.5,
        minHoldDays: 1.25,
        envelopeType: 1,
      }),
    ).rejects.toThrow("NEO gate values must be integers");
  });

  it("continues loading other envelopes when one envelope read fails", async () => {
    mockInvokeRead.mockImplementation(async (req: { operation: string; args?: Array<{ value: string }> }) => {
      if (req.operation === "getTotalEnvelopes") {
        return { stack: [{ type: "Integer", value: "3" }] };
      }
      if (req.operation === "getEnvelopeState") {
        const id = req.args?.[0]?.value;
        if (id === "2") throw new Error("temporary rpc error");

        return mapStack({
          creator: { type: "String", value: "0xcreator" },
          envelopeType: { type: "Integer", value: "0" },
          parentEnvelopeId: { type: "Integer", value: "0" },
          totalAmount: { type: "Integer", value: "100000000" },
          packetCount: { type: "Integer", value: "1" },
          openedCount: { type: "Integer", value: "0" },
          claimedCount: { type: "Integer", value: "0" },
          remainingAmount: { type: "Integer", value: "100000000" },
          remainingPackets: { type: "Integer", value: "1" },
          minNeoRequired: { type: "Integer", value: "1" },
          minHoldSeconds: { type: "Integer", value: "1" },
          active: { type: "Boolean", value: true },
          isExpired: { type: "Boolean", value: false },
          isDepleted: { type: "Boolean", value: false },
          currentHolder: { type: "String", value: "0xholder" },
          message: { type: "String", value: "ok" },
          expiryTime: { type: "Integer", value: "9999999999" },
        });
      }
      throw new Error(`Unexpected operation: ${req.operation}`);
    });

    const api = useRedEnvelope();
    await api.loadEnvelopes();

    expect(api.envelopes.value).toHaveLength(2);
    expect(api.envelopes.value.map((item) => item.id)).toEqual(["3", "1"]);
  });

  it("constructs GAS transfer payload correctly when creating envelope", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();

    await api.createEnvelope({
      totalGas: 1.5,
      packetCount: 3,
      expiryHours: 12,
      message: "gm",
      minNeo: 0,
      minHoldDays: 0,
      envelopeType: 1,
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const req = mockInvoke.mock.calls[0][0] as {
      scriptHash: string;
      operation: string;
      args: Array<{ type: string; value: unknown }>;
    };

    expect(req.scriptHash).toBe("0xd2a4cff31913016155e38e474a2c06d08be276cf");
    expect(req.operation).toBe("transfer");
    expect(req.args[0]).toEqual({ type: "Hash160", value: "NXV7ZhHiyM1aHXwpVsRZC6BwNFP2jghXAq" });
    expect(req.args[2]).toEqual({ type: "Integer", value: "150000000" });

    const dataArg = req.args[3] as { type: "Array"; value: Array<{ type: string; value: string }> };
    expect(dataArg.type).toBe("Array");
    expect(dataArg.value).toEqual([
      { type: "Integer", value: "3" },
      { type: "Integer", value: "43200000" },
      { type: "String", value: "gm" },
      { type: "Integer", value: "0" },
      { type: "Integer", value: "0" },
      { type: "Integer", value: "1" },
    ]);
  });

  it("uses correct operation names for open/transfer/reclaim flows", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();
    const makeEnvelope = (id: string, envelopeType: number) => ({
      id,
      creator: "0xcreator",
      envelopeType,
      parentEnvelopeId: "0",
      totalAmount: 1,
      packetCount: 1,
      openedCount: 0,
      claimedCount: 0,
      remainingAmount: 1,
      remainingPackets: 1,
      minNeoRequired: 1,
      minHoldSeconds: 1,
      active: true,
      expired: false,
      depleted: false,
      currentHolder: "0xholder",
      message: "",
      expiryTime: 0,
    });

    await api.openEnvelope(makeEnvelope("10", 0));
    await api.openEnvelope(makeEnvelope("11", 2));
    await api.claimFromPool("12");
    await api.transferEnvelope(makeEnvelope("13", 0), "NQvRtu7k7M5J8fS8gqZ2tu5G9D7wT7LQ1W");
    await api.transferEnvelope(makeEnvelope("14", 2), "NQvRtu7k7M5J8fS8gqZ2tu5G9D7wT7LQ1W");
    await api.reclaimEnvelope(makeEnvelope("15", 0));
    await api.reclaimEnvelope(makeEnvelope("16", 1));

    const ops = mockInvoke.mock.calls.map((call) => call[0].operation);
    expect(ops).toEqual([
      "openEnvelope",
      "openClaim",
      "claimFromPool",
      "transferEnvelope",
      "transferClaim",
      "reclaimEnvelope",
      "reclaimPool",
    ]);
  });

  it("rejects invalid envelope-type operations before sending tx", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();
    const makeEnvelope = (id: string, envelopeType: number) => ({
      id,
      creator: "0xcreator",
      envelopeType,
      parentEnvelopeId: "0",
      totalAmount: 1,
      packetCount: 1,
      openedCount: 0,
      claimedCount: 0,
      remainingAmount: 1,
      remainingPackets: 1,
      minNeoRequired: 1,
      minHoldSeconds: 1,
      active: true,
      expired: false,
      depleted: false,
      currentHolder: "0xholder",
      message: "",
      expiryTime: 0,
    });

    await expect(api.openEnvelope(makeEnvelope("20", 1))).rejects.toThrow("Use claimFromPool for pool envelopes");
    await expect(api.transferEnvelope(makeEnvelope("21", 1), "NQvRtu7k7M5J8fS8gqZ2tu5G9D7wT7LQ1W")).rejects.toThrow(
      "Pool envelopes cannot be transferred",
    );
    await expect(api.reclaimEnvelope(makeEnvelope("22", 2))).rejects.toThrow(
      "Claim NFTs cannot be reclaimed directly; reclaim the parent pool",
    );
  });

  it("allows transferring settled NFTs (inactive/depleted/expired)", async () => {
    mockInvoke.mockResolvedValue({ txid: "0xabc" });
    const api = useRedEnvelope();
    const makeEnvelope = (id: string, envelopeType: number) => ({
      id,
      creator: "0xcreator",
      envelopeType,
      parentEnvelopeId: "0",
      totalAmount: 1,
      packetCount: 1,
      openedCount: 1,
      claimedCount: 1,
      remainingAmount: 0,
      remainingPackets: 0,
      minNeoRequired: 0,
      minHoldSeconds: 0,
      active: false,
      expired: true,
      depleted: true,
      currentHolder: "0xholder",
      message: "",
      expiryTime: 0,
    });

    await api.transferEnvelope(makeEnvelope("30", 0), "NQvRtu7k7M5J8fS8gqZ2tu5G9D7wT7LQ1W");
    await api.transferEnvelope(makeEnvelope("31", 2), "NQvRtu7k7M5J8fS8gqZ2tu5G9D7wT7LQ1W");

    const ops = mockInvoke.mock.calls.map((call) => call[0].operation);
    expect(ops).toEqual(["transferEnvelope", "transferClaim"]);
  });
});
