export function parseOptionalNumber(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;

  return parsed;
}
