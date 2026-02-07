const SECONDS_THRESHOLD = 1_000_000_000_000;

/**
 * Contract timestamps are unix seconds. Some clients may still pass milliseconds,
 * so normalize both.
 */
export function toUnixMs(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  if (timestamp < SECONDS_THRESHOLD) {
    return timestamp * 1000;
  }
  return timestamp;
}

export function msUntilExpiry(expiryTimestamp: number, nowMs = Date.now()): number {
  const expiryMs = toUnixMs(expiryTimestamp);
  if (expiryMs <= 0) {
    return 0;
  }

  return Math.max(0, expiryMs - nowMs);
}

