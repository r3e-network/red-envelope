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

export type CountdownData = {
  expired: boolean;
  days: number;
  hours: number;
  mins: number;
  urgent: boolean;
};

/** Compute structured countdown from an expiry timestamp. Returns null if no expiry set. */
export function computeCountdown(
  expiryTimestamp: number,
  nowMs = Date.now(),
  isExpiredFlag = false,
): CountdownData | null {
  if (isExpiredFlag) return { expired: true, days: 0, hours: 0, mins: 0, urgent: true };
  if (!expiryTimestamp) return null;
  const diff = msUntilExpiry(expiryTimestamp, nowMs);
  if (diff <= 0) return { expired: true, days: 0, hours: 0, mins: 0, urgent: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const urgent = days === 0 && hours < 6;
  return { expired: false, days, hours, mins, urgent };
}

export type CountdownDisplay = { text: string; urgent: boolean };

/**
 * Format CountdownData into a display-ready object using the provided translate function.
 * Returns null if no countdown data. Uses 3-tier format: days+hours → hours+mins → mins-only.
 */
export function formatCountdownDisplay(
  cd: CountdownData | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: any, ...args: any[]) => string,
): CountdownDisplay | null {
  if (!cd) return null;
  if (cd.expired) return { text: t("expiredLabel"), urgent: true };
  if (cd.days > 0) return { text: t("daysRemaining", cd.days, cd.hours), urgent: cd.urgent };
  if (cd.hours > 0) return { text: t("hoursMinutes", cd.hours, cd.mins), urgent: cd.urgent };
  return { text: t("minutesOnly", cd.mins), urgent: true };
}
