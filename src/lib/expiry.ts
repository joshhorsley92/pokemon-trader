/** Quote expiry is computed lazily at render — no cron flips statuses. */
export function isQuoteExpired(
  status: string,
  quoteExpiresAt: Date,
): boolean {
  return status === "pending" && quoteExpiresAt.getTime() < Date.now();
}

/** Catalog prices are considered stale after 36h without a sync. */
export function isPriceDataStale(latest: Date | null): boolean {
  return !latest || Date.now() - latest.getTime() > 36 * 3600 * 1000;
}
