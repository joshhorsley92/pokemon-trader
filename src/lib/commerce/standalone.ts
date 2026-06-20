/**
 * StandaloneAdapter — the no-external-platform implementation.
 *
 * This is the adapter for shops that don't run on (or haven't connected) a
 * commerce platform: the trade counter is hosted by us, inventory lives only
 * in our own DB, and store credit is tracked in our own ledger. It exists from
 * day one so the core is provably platform-agnostic — if the core only ever
 * compiled against ShopifyAdapter it would quietly grow Shopify assumptions.
 *
 * The store-credit ledger and customer records land in a later phase; until
 * then issueStoreCredit records intent so the accept flow stays whole rather
 * than hard-failing.
 */
import type {
  AdapterShop,
  CommerceAdapter,
  CommerceCustomer,
  CommerceLocation,
  InventoryWriteItem,
  InventoryWriteResult,
  StoreCreditResult,
  StorefrontMount,
} from "./adapter";

/** Hosted path where a standalone shop's trade counter lives. */
function standalonePath(shop: AdapterShop): string {
  const base = process.env.APP_PUBLIC_URL ?? "";
  return `${base}/s/${shop.platformShopId ?? shop.id}`;
}

export class StandaloneAdapter implements CommerceAdapter {
  readonly platform = "standalone" as const;

  async getStorefrontMount(shop: AdapterShop): Promise<StorefrontMount> {
    return { url: standalonePath(shop), onMerchantDomain: false };
  }

  async resolveCustomer(
    _shop: AdapterShop,
    contact: { email: string; name: string | null; phone?: string | null },
  ): Promise<CommerceCustomer> {
    // No external platform: the submission's contact snapshot is the customer.
    return {
      platformCustomerId: null,
      email: contact.email,
      name: contact.name,
    };
  }

  async getLocations(_shop: AdapterShop): Promise<CommerceLocation[]> {
    // Inventory lives only in our DB; a single synthetic location.
    return [{ platformLocationId: "internal", name: "Store" }];
  }

  async writeInventory(
    _shop: AdapterShop,
    items: InventoryWriteItem[],
  ): Promise<InventoryWriteResult[]> {
    // Inventory already lives in our inventory_items table — nothing to push
    // to an external catalog. Report no platform ids.
    return items.map((i) => ({
      inventoryItemId: i.inventoryItemId,
      platformProductId: null,
      platformVariantId: null,
    }));
  }

  async issueStoreCredit(
    _shop: AdapterShop,
    _customer: CommerceCustomer,
    _amount: number,
    idempotencyKey: string,
  ): Promise<StoreCreditResult> {
    // Internal ledger lands in a later phase. Record the intent against the
    // submission id so the accept flow completes and is reconcilable.
    return { method: "store_credit", reference: `standalone:${idempotencyKey}` };
  }
}
