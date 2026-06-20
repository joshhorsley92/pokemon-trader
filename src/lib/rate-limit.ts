/**
 * Table-backed IP rate limiter — fine at this app's scale and works across
 * serverless instances (in-memory counters don't).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";

const WINDOW_MINUTES = 60;
const MAX_PER_WINDOW = 3;

export async function checkRateLimit(
  shopId: string,
  ip: string,
): Promise<boolean> {
  // Bucket timestamps to the start of the current window
  const windowStart = new Date(
    Math.floor(Date.now() / (WINDOW_MINUTES * 60_000)) *
      (WINDOW_MINUTES * 60_000),
  );
  const [row] = await db
    .insert(tables.submissionRateLimits)
    .values({ shopId, ip, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [
        tables.submissionRateLimits.shopId,
        tables.submissionRateLimits.ip,
        tables.submissionRateLimits.windowStart,
      ],
      set: { count: sql`${tables.submissionRateLimits.count} + 1` },
    })
    .returning({ count: tables.submissionRateLimits.count });

  // Opportunistic cleanup of old windows
  await db
    .delete(tables.submissionRateLimits)
    .where(
      and(
        eq(tables.submissionRateLimits.shopId, shopId),
        eq(tables.submissionRateLimits.ip, ip),
        sql`${tables.submissionRateLimits.windowStart} < now() - interval '1 day'`,
      ),
    );

  return (row?.count ?? 1) <= MAX_PER_WINDOW;
}
