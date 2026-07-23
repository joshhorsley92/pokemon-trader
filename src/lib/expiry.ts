/** Quote expiry is computed lazily at render — no cron flips statuses. */
export function isQuoteExpired(
  status: string,
  quoteExpiresAt: Date,
): boolean {
  return status === "pending" && quoteExpiresAt.getTime() < Date.now();
}

/** Whole days elapsed since `date` (0 for today/null). */
export function daysSince(date: Date | null): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

/** Catalog prices are considered stale after 36h without a sync. */
export function isPriceDataStale(latest: Date | null): boolean {
  return !latest || Date.now() - latest.getTime() > 36 * 3600 * 1000;
}
