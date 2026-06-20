/**
 * Pricing-data provider factory. For the MVP the source is a single global
 * choice (env: PRICING_DATA_PROVIDER, default "tcgcsv"); per-shop providers
 * become a later refinement once the catalog is no longer purely TCGplayer-id
 * keyed. JustTCG/Scrydex register here when implemented (before paid launch).
 */
import { TcgcsvProvider } from "./tcgcsv-provider";
import type { PricingDataProvider } from "./provider";

export type {
  NormalizedGroup,
  NormalizedProduct,
  PricingDataProvider,
} from "./provider";

const providers: Record<string, () => PricingDataProvider> = {
  tcgcsv: () => new TcgcsvProvider(),
  // justtcg: () => new JustTcgProvider(),   // before commercial launch
};

export function getProvider(
  source = process.env.PRICING_DATA_PROVIDER ?? "tcgcsv",
): PricingDataProvider {
  const make = providers[source];
  if (!make) throw new Error(`Unknown pricing-data provider: ${source}`);
  return make();
}
