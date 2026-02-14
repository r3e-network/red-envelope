import { describe, it, expect, vi } from "vitest";
import { pAll } from "./concurrency";

describe("pAll", () => {
  it("returns empty array for empty input", async () => {
    const result = await pAll([]);
    expect(result).toEqual([]);
  });

  it("executes tasks in order with results in same order", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const result = await pAll(tasks);

    expect(result).toEqual([1, 2, 3]);
  });

  it("respects concurrency limit", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }, (_, i) => {
      return () =>
        new Promise<number>((resolve) => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);

          // Simulate async work
          setTimeout(() => {
            concurrentCount--;
            resolve(i);
          }, 10);
        });
    });

    const result = await pAll(tasks, 3);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(result).toHaveLength(10);
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("propagates errors from tasks", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error("Task failed")),
      () => Promise.resolve(3),
    ];

    await expect(pAll(tasks)).rejects.toThrow("Task failed");
  });

  it("handles single task", async () => {
    const tasks = [() => Promise.resolve("single")];

    const result = await pAll(tasks);

    expect(result).toEqual(["single"]);
  });

  it("handles tasks that resolve simultaneously", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];

    const result = await pAll(tasks, 10);

    expect(result).toEqual(["a", "b", "c"]);
  });

  it("uses default concurrency limit of 6", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 20 }, (_, i) => {
      return () =>
        new Promise<number>((resolve) => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);

          setTimeout(() => {
            concurrentCount--;
            resolve(i);
          }, 5);
        });
    });

    const result = await pAll(tasks); // No limit specified, should default to 6

    expect(maxConcurrent).toBeLessThanOrEqual(6);
    expect(result).toHaveLength(20);
  });

  it("handles concurrency limit greater than task count", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
    ];

    const result = await pAll(tasks, 100);

    expect(result).toEqual([1, 2]);
  });

  it("treats non-positive concurrency limits as 1", async () => {
    const executionOrder: number[] = [];
    const tasks = Array.from({ length: 4 }, (_, i) => {
      return () =>
        new Promise<number>((resolve) => {
          executionOrder.push(i);
          setTimeout(() => resolve(i), 5);
        });
    });

    const zeroLimitResult = await pAll(tasks, 0);
    const negativeLimitResult = await pAll(tasks, -3);

    expect(executionOrder).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(zeroLimitResult).toEqual([0, 1, 2, 3]);
    expect(negativeLimitResult).toEqual([0, 1, 2, 3]);
  });

  it("preserves result order even when tasks complete out of order", async () => {
    const tasks = [
      () => new Promise((resolve) => setTimeout(() => resolve(1), 30)),
      () => new Promise((resolve) => setTimeout(() => resolve(2), 10)),
      () => new Promise((resolve) => setTimeout(() => resolve(3), 20)),
    ];

    const result = await pAll(tasks, 3);

    // Results should be in original order, not completion order
    expect(result).toEqual([1, 2, 3]);
  });

  it("handles tasks returning different types", async () => {
    const tasks: Array<() => Promise<unknown>> = [
      () => Promise.resolve(42),
      () => Promise.resolve("string"),
      () => Promise.resolve({ key: "value" }),
      () => Promise.resolve([1, 2, 3]),
    ];

    const result = await pAll(tasks);

    expect(result).toEqual([42, "string", { key: "value" }, [1, 2, 3]]);
  });

  it("handles tasks returning promises that reject after delay", async () => {
    const tasks = [
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("Delayed error")), 10)),
    ];

    await expect(pAll(tasks)).rejects.toThrow("Delayed error");
  });

  it("handles concurrency limit of 1 (sequential execution)", async () => {
    const executionOrder: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) => {
      return () =>
        new Promise<number>((resolve) => {
          executionOrder.push(i);
          setTimeout(() => resolve(i), 5);
        });
    });

    const result = await pAll(tasks, 1);

    // With limit=1, tasks should execute in exact order
    expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles async functions that throw synchronously", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => {
        throw new Error("Sync error in async function");
      },
      () => Promise.resolve(3),
    ] as Array<() => Promise<number>>;

    await expect(pAll(tasks)).rejects.toThrow();
  });
});
