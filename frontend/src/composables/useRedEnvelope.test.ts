import { describe, it, expect, vi, beforeEach } from "vitest";

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
});
