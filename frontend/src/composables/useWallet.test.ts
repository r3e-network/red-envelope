import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("useWallet", () => {
  let mockWindow: any;

  beforeEach(async () => {
    vi.resetModules(); // Reset module cache

    // Create fresh window mock
    mockWindow = {
      NEOLineN3: null,
      NEOLine: null,
      OneGate: null,
      neo: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal("window", mockWindow);

    // Mock neo utils
    vi.mock("@/utils/neo", () => ({
      addressToScriptHashHex: vi.fn((addr: string) => {
        if (addr === "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP") {
          return "0x1234567890abcdef1234567890abcdef12345678";
        }
        return null;
      }),
    }));

    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.unstubAllGlobals();
  });

  describe("wallet priority", () => {
    it("prioritizes OneGate over other wallets", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress1 = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockAddress2 = "NXV7ZhHiyM1aHXwpVsRZC6BwNFP2jghXAq";

      mockWindow.OneGate = {
        request: vi.fn().mockResolvedValue({ address: mockAddress1 }),
      };
      mockWindow.neo = {
        request: vi.fn().mockResolvedValue({ address: mockAddress2 }),
      };

      const wallet = useWallet();
      const result = await wallet.connect();

      expect(result).toBe(mockAddress1);
      expect(mockWindow.OneGate.request).toHaveBeenCalled();
      expect(mockWindow.neo.request).not.toHaveBeenCalled();
    });

    it("uses generic neo if OneGate not available", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";

      mockWindow.neo = {
        request: vi.fn().mockResolvedValue({ address: mockAddress }),
      };

      const wallet = useWallet();
      const result = await wallet.connect();

      expect(result).toBe(mockAddress);
      expect(wallet.connected.value).toBe(true);
    });

    it("uses NeoLine if OneGate and neo not available", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockNeoLineInstance = {
        getAccount: vi.fn().mockResolvedValue({ address: mockAddress, label: "Test" }),
        invoke: vi.fn(),
        invokeRead: vi.fn(),
        getBalance: vi.fn(),
      };

      mockWindow.NEOLineN3 = {
        Init: vi.fn(() => mockNeoLineInstance),
      };

      const wallet = useWallet();
      const result = await wallet.connect();

      expect(result).toBe(mockAddress);
      expect(wallet.connected.value).toBe(true);
    });
  });

  describe("error handling", () => {
    it("throws when no wallet detected", async () => {
      const { useWallet } = await import("./useWallet");

      const wallet = useWallet();
      await expect(wallet.connect()).rejects.toThrow("No Neo wallet detected");
    });

    it("getBalance returns 0 when no wallet detected", async () => {
      const { useWallet } = await import("./useWallet");

      const wallet = useWallet();
      const result = await wallet.getBalance("0x1234567890abcdef");
      expect(result).toBe("0");
    });

    it("invokeRead works via rpc even when no wallet detected", async () => {
      const { useWallet } = await import("./useWallet");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          result: { stack: [{ type: "Integer", value: "1" }] },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const wallet = useWallet();
      const result = await wallet.invokeRead({
        scriptHash: "0x1234567890abcdef",
        operation: "testMethod",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ stack: [{ type: "Integer", value: "1" }] });
    });
  });

  describe("NeoLine wrapper", () => {
    it("converts Hash160 N-addresses to script hashes in args", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockNeoLineInstance = {
        getAccount: vi.fn().mockResolvedValue({ address: mockAddress, label: "Test" }),
        invoke: vi.fn().mockResolvedValue({ txid: "0xabc" }),
        invokeRead: vi.fn(),
        getBalance: vi.fn(),
      };

      mockWindow.NEOLineN3 = {
        Init: vi.fn(() => mockNeoLineInstance),
      };

      const wallet = useWallet();
      await wallet.connect();

      await wallet.invoke({
        scriptHash: "0x1234567890abcdef",
        operation: "transfer",
        args: [{ type: "Hash160", value: "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP" }],
      });

      const invokeCall = mockNeoLineInstance.invoke.mock.calls[0][0];
      expect(invokeCall.args[0].value).toBe("0x1234567890abcdef1234567890abcdef12345678");
    });

    it("recursively processes nested arrays in args", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockNeoLineInstance = {
        getAccount: vi.fn().mockResolvedValue({ address: mockAddress, label: "Test" }),
        invoke: vi.fn().mockResolvedValue({ txid: "0xabc" }),
        invokeRead: vi.fn(),
        getBalance: vi.fn(),
      };

      mockWindow.NEOLineN3 = {
        Init: vi.fn(() => mockNeoLineInstance),
      };

      const wallet = useWallet();
      await wallet.connect();

      await wallet.invoke({
        scriptHash: "0x1234567890abcdef",
        operation: "test",
        args: [
          {
            type: "Array",
            value: [{ type: "Hash160", value: "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP" }],
          },
        ],
      });

      const invokeCall = mockNeoLineInstance.invoke.mock.calls[0][0];
      expect(invokeCall.args[0].value[0].value).toBe("0x1234567890abcdef1234567890abcdef12345678");
    });

    it("leaves non-Hash160 types unchanged", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockNeoLineInstance = {
        getAccount: vi.fn().mockResolvedValue({ address: mockAddress, label: "Test" }),
        invoke: vi.fn().mockResolvedValue({ txid: "0xabc" }),
        invokeRead: vi.fn(),
        getBalance: vi.fn(),
      };

      mockWindow.NEOLineN3 = {
        Init: vi.fn(() => mockNeoLineInstance),
      };

      const wallet = useWallet();
      await wallet.connect();

      await wallet.invoke({
        scriptHash: "0x1234567890abcdef",
        operation: "test",
        args: [
          { type: "Integer", value: "100" },
          { type: "String", value: "hello" },
          { type: "Boolean", value: true },
        ],
      });

      const invokeCall = mockNeoLineInstance.invoke.mock.calls[0][0];
      expect(invokeCall.args[0]).toEqual({ type: "Integer", value: "100" });
      expect(invokeCall.args[1]).toEqual({ type: "String", value: "hello" });
      expect(invokeCall.args[2]).toEqual({ type: "Boolean", value: true });
    });

    it("converts signers to bare hex and numeric scopes", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockNeoLineInstance = {
        getAccount: vi.fn().mockResolvedValue({ address: mockAddress, label: "Test" }),
        invoke: vi.fn().mockResolvedValue({ txid: "0xabc" }),
        invokeRead: vi.fn(),
        getBalance: vi.fn(),
      };

      mockWindow.NEOLineN3 = {
        Init: vi.fn(() => mockNeoLineInstance),
      };

      const wallet = useWallet();
      await wallet.connect();

      await wallet.invoke({
        scriptHash: "0x1234567890abcdef",
        operation: "test",
        signers: [{ account: "0xabcdef", scopes: "Global" }],
      });

      const invokeCall = mockNeoLineInstance.invoke.mock.calls[0][0];
      expect(invokeCall.signers[0].account).toBe("abcdef"); // No 0x prefix
      expect(invokeCall.signers[0].scopes).toBe(128); // Global = 128
    });
  });

  describe("successful wallet operations", () => {
    it("sets address and connected on successful connection", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      mockWindow.OneGate = {
        request: vi.fn().mockResolvedValue({ address: mockAddress }),
      };

      const wallet = useWallet();
      const result = await wallet.connect();

      expect(result).toBe(mockAddress);
      expect(wallet.address.value).toBe(mockAddress);
      expect(wallet.connected.value).toBe(true);
    });

    it("returns balance on success", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockBalance = "100000000";

      const requestMock = vi
        .fn()
        .mockResolvedValueOnce({ address: mockAddress }) // getAccount
        .mockResolvedValueOnce([{ balance: mockBalance }]); // getBalance

      mockWindow.OneGate = { request: requestMock };

      const wallet = useWallet();
      const result = await wallet.getBalance("0xd2a4cff31913016155e38e474a2c06d08be276cf");

      expect(result).toBe(mockBalance);
    });

    it("auto-connects before invoke if not connected", async () => {
      const { useWallet } = await import("./useWallet");

      const mockAddress = "NLtL2v28d7TYdqLJhC7BbEwSts8rJBNmkP";
      const mockInvokeResult = { txid: "0xabc123" };

      const requestMock = vi
        .fn()
        .mockResolvedValueOnce({ address: mockAddress }) // First call: getAccount
        .mockResolvedValueOnce(mockInvokeResult); // Second call: invoke

      mockWindow.OneGate = { request: requestMock };

      const wallet = useWallet();
      const result = await wallet.invoke({
        scriptHash: "0x1234567890abcdef",
        operation: "testMethod",
        args: [],
      });

      expect(result).toEqual(mockInvokeResult);
      expect(wallet.connected.value).toBe(true);
    });
  });
});
