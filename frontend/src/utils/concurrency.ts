/**
 * Run async tasks with bounded concurrency (like p-limit but zero-dep).
 *
 * @param tasks  Array of zero-arg async functions to execute
 * @param limit  Max concurrent tasks (default 6)
 * @returns      Results in the same order as the input tasks
 */
export async function pAll<T>(tasks: (() => Promise<T>)[], limit = 6): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
