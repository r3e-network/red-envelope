export function parseOptionalNumber(raw: string | number, fallback: number): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : fallback;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;

  return parsed;
}
