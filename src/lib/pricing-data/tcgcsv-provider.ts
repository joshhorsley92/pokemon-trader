/**
 * TCGCSV implementation of PricingDataProvider. Composes the existing
 * src/lib/tcgcsv.ts client into the normalized shape the sync layer expects.
 */
import {
  classifyProduct,
  effectiveMarketPrice,
  fetchGroups,
  fetchPrices,
  fetchProducts,
  pickPrice,
  serializePrintings,
  type TcgcsvPrice,
} from "@/lib/tcgcsv";
import type {
  NormalizedGroup,
  NormalizedProduct,
  PricingDataProvider,
} from "./provider";

export class TcgcsvProvider implements PricingDataProvider {
  readonly source = "tcgcsv";

  async listGroups(): Promise<NormalizedGroup[]> {
    const groups = await fetchGroups();
    return groups.map((g) => ({
      id: g.groupId,
      name: g.name,
      abbreviation: g.abbreviation,
      publishedOn: g.publishedOn,
      modifiedOn: g.modifiedOn,
    }));
  }

  async listProducts(groupId: number): Promise<NormalizedProduct[]> {
    const [products, prices] = await Promise.all([
      fetchProducts(groupId),
      fetchPrices(groupId),
    ]);

    const pricesByProduct = new Map<number, TcgcsvPrice[]>();
    for (const p of prices) {
      const list = pricesByProduct.get(p.productId);
      if (list) list.push(p);
      else pricesByProduct.set(p.productId, [p]);
    }

    return products.map((product) => {
      const rows = pricesByProduct.get(product.productId) ?? [];
      const headline = pickPrice(rows);
      return {
        id: product.productId,
        groupId: product.groupId,
        name: product.name,
        cleanName: product.cleanName,
        category: classifyProduct(product),
        imageUrl: product.imageUrl,
        sourceUrl: product.url,
        extData: product.extendedData ?? null,
        marketPrice: headline ? effectiveMarketPrice(headline) : null,
        lowPrice: headline?.lowPrice ?? null,
        printings: serializePrintings(rows),
      };
    });
  }
}
