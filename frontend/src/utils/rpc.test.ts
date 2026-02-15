import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractEnvelopeCreatedId, waitForConfirmation } from "./rpc";

describe("waitForConfirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for poll interval before retrying non-OK RPC responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    const pending = waitForConfirmation("0xtest", 3500);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    await pending;
  });

  it("throws immediately on VM FAULT after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          executions: [{ vmstate: "FAULT", exception: "boom" }],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(waitForConfirmation("0xtest")).rejects.toThrow("Transaction FAULT: boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("extractEnvelopeCreatedId", () => {
  it("extracts id from EnvelopeCreated notification", () => {
    const id = extractEnvelopeCreatedId(
      {
        executions: [
          {
            notifications: [
              {
                contract: "0xABCDEF",
                eventname: "EnvelopeCreated",
                state: {
                  type: "Array",
                  value: [
                    { type: "Integer", value: "42" },
                    { type: "ByteString", value: "ignored" },
                  ],
                },
              },
            ],
          },
        ],
      },
      "0xabcdef",
    );
    expect(id).toBe("42");
  });

  it("returns null when no matching notification exists", () => {
    const id = extractEnvelopeCreatedId({
      executions: [
        {
          notifications: [{ eventname: "Transfer", state: { type: "Array", value: [] } }],
        },
      ],
    });
    expect(id).toBe(null);
  });
});
