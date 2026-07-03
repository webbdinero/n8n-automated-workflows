/** Date helpers that operate on ISO calendar dates (YYYY-MM-DD) in UTC. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD string to a UTC timestamp (ms). Returns NaN if invalid. */
export function parseIsoDate(d: string | null | undefined): number {
  if (!d) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `a` to `b` (b - a). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ta = parseIsoDate(a);
  const tb = parseIsoDate(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return NaN;
  return Math.round((tb - ta) / DAY_MS);
}

/** Today's date as YYYY-MM-DD (UTC). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Current timestamp as ISO-8601 datetime. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Add `n` days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(d: string, n: number): string {
  const t = parseIsoDate(d);
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}
