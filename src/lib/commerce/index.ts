/**
 * Commerce adapter factory. Selects a shop's CommerceAdapter from its
 * `platform`. Shopify (and later Square/Lightspeed) register here as they land;
 * standalone is always available as the fallback.
 */
import type { AdapterShop, CommerceAdapter, CommercePlatform } from "./adapter";
import { StandaloneAdapter } from "./standalone";

export type { AdapterShop, CommerceAdapter, CommercePlatform } from "./adapter";

const standalone = new StandaloneAdapter();

/** Adapters by platform. New platforms register here as their adapter lands. */
const adapters: Partial<Record<CommercePlatform, CommerceAdapter>> = {
  standalone,
  // shopify: new ShopifyAdapter(),   // Phase 1
};

export function getAdapter(shop: Pick<AdapterShop, "platform">): CommerceAdapter {
  return adapters[shop.platform] ?? standalone;
}
