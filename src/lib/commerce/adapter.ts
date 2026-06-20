/**
 * CommerceAdapter — the portability seam between the trade-in/buylist core and
 * whatever storefront/commerce platform a shop runs on.
 *
 * The core (pricing engine, quote/counter flow, buylist analyzer, trade
 * counter) NEVER imports a platform SDK directly. Everything platform-specific
 * — where the customer-facing trade counter is served, who the customer is,
 * pushing acquired inventory out, and paying the customer in store credit —
 * goes through this interface.
 *
 * Shopify is the first concrete adapter (the beachhead). Square, Lightspeed,
 * and a fully standalone hosted mode become later adapters, opening the ~half
 * of card shops that aren't on Shopify. A shop's `platform` column selects its
 * adapter via getAdapter() in ./index.
 */

/** Identifies a shop's commerce platform; drives adapter selection. */
export type CommercePlatform =
  | "standalone"
  | "shopify"
  | "square"
  | "lightspeed";

/** Minimal shop context an adapter needs to act on a specific tenant. */
export type AdapterShop = {
  id: string;
  platform: CommercePlatform;
  /** Platform-native shop identifier, e.g. the *.myshopify.com domain. */
  platformShopId: string | null;
};

/** Where (and how) the customer-facing trade counter is mounted for a shop. */
export type StorefrontMount = {
  /**
   * Absolute or shop-relative URL where customers reach the trade counter.
   * For Shopify this is an app-proxy path under the shop's own domain
   * (e.g. https://shop.com/apps/trade-in); for standalone it's our hosted
   * path (e.g. https://app.example.com/s/<shop>).
   */
  url: string;
  /** True when the counter lives on the merchant's own domain (the wedge). */
  onMerchantDomain: boolean;
};

/** A customer resolved (or created) on the underlying platform. */
export type CommerceCustomer = {
  /** Platform-native customer id; null in standalone mode. */
  platformCustomerId: string | null;
  email: string;
  name: string | null;
};

/** A fulfillment location items can be stocked into (e.g. a Shopify location). */
export type CommerceLocation = {
  platformLocationId: string;
  name: string;
};

/** One acquired line to push into the shop's catalog when a trade is accepted. */
export type InventoryWriteItem = {
  /** Our inventory_items.id, for write-back of the platform ids. */
  inventoryItemId: string;
  /** Matched catalog product, when known — lets adapters enrich the listing. */
  catalogProductId: number | null;
  title: string;
  condition: string | null;
  quantity: number;
  /** Asking price in the shop's currency; null = let the shop price it. */
  price: number | null;
  imageUrl: string | null;
};

/** Result of writing one item out; ids are stored back on inventory_items. */
export type InventoryWriteResult = {
  inventoryItemId: string;
  platformProductId: string | null;
  platformVariantId: string | null;
};

export type StoreCreditMethod = "store_credit" | "gift_card" | "discount";

export type StoreCreditResult = {
  method: StoreCreditMethod;
  /** Platform reference (store-credit txn id, gift-card id, discount code). */
  reference: string;
};

/**
 * Operations the core performs against a shop's commerce platform. All methods
 * are tenant-scoped via the `shop` argument. Implementations must be
 * idempotent where the caller may retry (inventory write-out, credit issuance).
 */
export interface CommerceAdapter {
  readonly platform: CommercePlatform;

  /** Where the trade counter is served for this shop. */
  getStorefrontMount(shop: AdapterShop): Promise<StorefrontMount>;

  /** Resolve, or create, the platform customer for a submission's contact. */
  resolveCustomer(
    shop: AdapterShop,
    contact: { email: string; name: string | null; phone?: string | null },
  ): Promise<CommerceCustomer>;

  /** Stockable locations; the first is treated as the default. */
  getLocations(shop: AdapterShop): Promise<CommerceLocation[]>;

  /**
   * Push accepted trade-in inventory into the shop's catalog. Must be
   * idempotent: re-running with the same items must not create duplicates.
   */
  writeInventory(
    shop: AdapterShop,
    items: InventoryWriteItem[],
  ): Promise<InventoryWriteResult[]>;

  /**
   * Pay the customer their accepted trade value as store credit. Must be
   * idempotent on `idempotencyKey` (the submission id) so a retry after a
   * partial failure never double-pays.
   */
  issueStoreCredit(
    shop: AdapterShop,
    customer: CommerceCustomer,
    amount: number,
    idempotencyKey: string,
  ): Promise<StoreCreditResult>;
}
