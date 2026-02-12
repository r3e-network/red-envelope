/**
 * Run async tasks with bounded concurrency (like p-limit but zero-dep).
 *
 * @param tasks  Array of zero-arg async functions to execute
 * @param limit  Max concurrent tasks (default 6)
 * @returns      Results in the same order as the input tasks
 */
export async function pAll<T>(tasks: (() => Promise<T>)[], limit = 6): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next;
      if (idx >= tasks.length) break;
      next = idx + 1;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
