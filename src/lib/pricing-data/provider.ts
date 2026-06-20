/**
 * PricingDataProvider — the seam between the catalog/price layer and where
 * that data comes from.
 *
 * The app reads prices from our own `catalog_products` table at request time
 * (see quote.ts, hot-buys.ts) — a provider is never hit on the request path.
 * A provider's job is the SYNC layer: fetch a source's catalog + prices and
 * normalize them into our `catalog_products` shape. That means swapping
 * sources (TCGCSV now → a licensed provider like JustTCG/Scrydex before
 * commercial launch) only changes the sync, not the quoting engine.
 *
 * TCGCSV is fine for an internal/single tenant; it's a ToS/IP gray area for a
 * commercial multi-tenant product, which is exactly why this seam exists.
 */
import type { ProductPrinting } from "@/lib/tcgcsv";

/** A set/group, normalized across sources, ready to upsert into catalog_groups. */
export type NormalizedGroup = {
  /** Stable source-native id (TCGplayer groupId for TCGCSV). */
  id: number;
  name: string;
  abbreviation: string | null;
  /** ISO date string or null. */
  publishedOn: string | null;
  /** Raw source modified marker, used for delta-skipping unchanged groups. */
  modifiedOn: string | null;
};

/** A product with prices merged in, ready to upsert into catalog_products. */
export type NormalizedProduct = {
  /** Stable source-native id (TCGplayer productId for TCGCSV). */
  id: number;
  groupId: number;
  name: string;
  cleanName: string | null;
  category: "singles" | "sealed";
  imageUrl: string | null;
  sourceUrl: string | null;
  /** Source-specific extended attributes, stored as-is. */
  extData: unknown;
  /** Headline market price (the printing mirrored into market_price). */
  marketPrice: number | null;
  lowPrice: number | null;
  /** All printings, headline-first; [] for single-printing products. */
  printings: ProductPrinting[];
};

/**
 * A data source for catalog + pricing. Implementations normalize their native
 * shapes into the types above so the sync script is source-agnostic.
 */
export interface PricingDataProvider {
  /** Stable source key, stored on catalog rows when sources can diverge. */
  readonly source: string;

  /** All groups/sets available from this source. */
  listGroups(): Promise<NormalizedGroup[]>;

  /** All products in a group, with current prices + printings merged in. */
  listProducts(groupId: number): Promise<NormalizedProduct[]>;
}
