/**
 * Tenant context. Every shop-scoped query is filtered by a `shopId`; this
 * module is where that id comes from.
 *
 * Phase 0 (this commit) is still single-shop: the app runs for one pilot shop
 * and `getCurrentShopId()` returns its fixed id. The plumbing — every data-layer
 * function taking an explicit `shopId`, every call site resolving it here — is
 * in place so that flipping to real per-request resolution (App Bridge session
 * token for embedded admin, signed app-proxy params for the storefront, the
 * shop domain for webhooks) is a change to THIS function alone, not a sweep of
 * every query again.
 *
 * The pilot shop row is seeded by migration/seed with this exact id.
 */

/** Fixed id of the single pilot shop during Phase 0. */
export const PILOT_SHOP_ID = "00000000-0000-0000-0000-000000000001";

/**
 * The current request's shop id. Returns the pilot shop for now; becomes
 * request-scoped resolution in Phase 4 (multi-tenant). Async so callers don't
 * change signature when real resolution (reading headers/session) lands.
 */
export async function getCurrentShopId(): Promise<string> {
  return PILOT_SHOP_ID;
}
