/**
 * Buy/sell decision engine — the internal "should we buylist this card,
 * sell it on TCGplayer, or treat it as bulk?" math, ported from Josh's
 * mtg-sell-helper.
 *
 * Pure module: no DB, no fetch. Callers load offers/prices and pass them in,
 * so the whole thing is unit-testable (mirrors src/lib/pricing.ts).
 *
 * All money math is done in cents (integers) to avoid float drift.
 */
import {
  conditionMultiplier,
  type ConditionMultipliers,
  DEFAULT_CONDITION_MULTIPLIERS,
} from "@/lib/conditions";

export type AnalyzerEconomics = {
  /** TCGplayer marketplace + payment fee, percent of sale (e.g. 12.75) */
  tcg_fee_pct: number;
  /** Fixed payment-processing fee per order, dollars */
  tcg_fixed_per_order: number;
  /** Sleeve + toploader + envelope + label cost per order, dollars */
  tcg_materials_per_order: number;
  /** Listing/pulling/packing labor cost per order, dollars */
  tcg_labor_per_order: number;
  /** Average cards sold per TCGplayer order (1 = conservative) */
  tcg_cards_per_order: number;
  /** Cost to ship one buylist batch to a vendor, dollars (amortized) */
  buylist_shipping_flat: number;
  /** Ignore vendor offers below this, dollars */
  buylist_min_offer: number;
  /** Cards with market price below this are BULK regardless, dollars */
  bulk_market_threshold: number;
  /** What bulk buyers pay per common/uncommon card, dollars (0 = ignore) */
  bulk_rate_per_card: number;
  /** Flag cards at/above this market price for manual verification, dollars */
  high_value_flag: number;
};

export const DEFAULT_ANALYZER_ECONOMICS: AnalyzerEconomics = {
  tcg_fee_pct: 13.85,
  tcg_fixed_per_order: 0.3,
  tcg_materials_per_order: 1.0,
  tcg_labor_per_order: 0.5,
  tcg_cards_per_order: 1,
  buylist_shipping_flat: 5.0,
  buylist_min_offer: 0.1,
  bulk_market_threshold: 0.25,
  bulk_rate_per_card: 0.01,
  high_value_flag: 50,
};

export type VendorOffer = {
  vendor: string;
  /** NM cash buy price, dollars (null = credit only) */
  cashPrice: number | null;
  /** NM store-credit buy price, dollars */
  creditPrice: number | null;
  /** Vendor-published per-condition cash ladder, e.g. {NM: 2.5, LP: 2.25} */
  conditionPrices?: Record<string, number> | null;
  buying: boolean;
  url?: string | null;
};

export type AnalyzerItem = {
  /** TCGplayer product id (null = unmatched list line) */
  productId: number | null;
  name: string;
  setName?: string | null;
  quantity: number;
  /** Singles condition value (NM/LP/MP/HP/Damaged); null treated as NM */
  condition?: string | null;
  /** TCGplayer market price (NM), dollars */
  marketPrice: number | null;
  /** Sealed product (ETB, collection box, ...) — no buylists, never bulk */
  category?: "singles" | "sealed";
  // Export metadata (vendor pick lists, TCGplayer import CSV) — passed
  // through untouched by the engine.
  cardNumber?: string | null;
  rarity?: string | null;
  printing?: string | null;
  /** Real TCGplayer product id only (never synthetic) — import CSV column */
  tcgplayerId?: number | null;
  offers: VendorOffer[];
};

export type Decision = "BUYLIST" | "TCG" | "BULK";

export type ItemResult = {
  item: AnalyzerItem;
  decision: Decision;
  /** Best vendor offer after condition adjustment, before shipping */
  bestOffer: {
    vendor: string;
    cash: number | null;
    credit: number | null;
    url?: string | null;
  } | null;
  /** Per-unit net if shipped to the best buylist vendor, dollars */
  netBuylist: number | null;
  /**
   * Condition-adjusted expected sale price on TCGplayer, dollars
   * (market × condition multiplier) — the basis netTcg is computed from.
   */
  estSalePrice: number | null;
  /** Per-unit net if sold on TCGplayer at market, dollars */
  netTcg: number | null;
  /** Per-unit value if moved as bulk, dollars */
  netBulk: number;
  flags: string[]; // e.g. "high value — verify", "unmatched", "no market price"
};

export type AnalyzerSummary = {
  results: ItemResult[];
  totals: {
    buylistCash: number;
    buylistCredit: number;
    tcgNet: number;
    bulk: number;
    cards: number;
  };
  /** Cards per vendor batch (drives shipping amortization shown in UI) */
  vendorBatches: Record<
    string,
    { cards: number; cash: number; credit: number; shipping: number }
  >;
};

function toCents(d: number): number {
  return Math.round(d * 100);
}
function toDollars(c: number): number {
  return c / 100;
}

/**
 * Condition-adjusted cash/credit offer for a vendor. Uses the vendor's own
 * published ladder when present; otherwise estimates by applying our singles
 * condition multiplier to their NM price (vendors regrade on receipt anyway —
 * this keeps the estimate honest instead of optimistic).
 */
export function adjustOffer(
  offer: VendorOffer,
  condition: string | null | undefined,
  multipliers: ConditionMultipliers,
): { cash: number | null; credit: number | null } {
  const cond = condition ?? "NM";
  const ladder = offer.conditionPrices ?? undefined;
  if (ladder && ladder[cond] !== undefined) {
    const cash = ladder[cond];
    // Scale credit by the same ratio the ladder applies to NM cash
    const ratio =
      offer.cashPrice && offer.cashPrice > 0 ? cash / offer.cashPrice : 1;
    return {
      cash,
      credit:
        offer.creditPrice !== null
          ? toDollars(toCents(offer.creditPrice * ratio))
          : null,
    };
  }
  const mult = conditionMultiplier(multipliers, "singles", cond);
  return {
    cash:
      offer.cashPrice !== null
        ? toDollars(Math.round(toCents(offer.cashPrice) * mult))
        : null,
    credit:
      offer.creditPrice !== null
        ? toDollars(Math.round(toCents(offer.creditPrice) * mult))
        : null,
  };
}

/** Per-unit net proceeds of a TCGplayer market-price sale. */
export function netTcgUnit(
  marketPrice: number,
  condition: string | null | undefined,
  eco: AnalyzerEconomics,
  multipliers: ConditionMultipliers,
): number {
  const mult = conditionMultiplier(multipliers, "singles", condition ?? "NM");
  const saleCents = Math.round(toCents(marketPrice) * mult);
  // Multiply before dividing: 13.85/100 is inexact in floats and can flip
  // the cent rounding on exact-half fees.
  const fees = Math.round((saleCents * eco.tcg_fee_pct) / 100);
  const perOrderCents =
    toCents(eco.tcg_fixed_per_order) +
    toCents(eco.tcg_materials_per_order) +
    toCents(eco.tcg_labor_per_order);
  const perCardOverhead = Math.round(
    perOrderCents / Math.max(1, eco.tcg_cards_per_order),
  );
  return toDollars(saleCents - fees - perCardOverhead);
}

/**
 * Run decisions over a list. Shipping is amortized per vendor batch and the
 * loop re-runs until decisions stabilize: dropping a card from a vendor batch
 * raises everyone else's shipping share, which can drop further cards.
 */
export function analyze(
  items: AnalyzerItem[],
  eco: AnalyzerEconomics = DEFAULT_ANALYZER_ECONOMICS,
  multipliers: ConditionMultipliers = DEFAULT_CONDITION_MULTIPLIERS,
): AnalyzerSummary {
  type Work = {
    item: AnalyzerItem;
    best: { offer: VendorOffer; cash: number | null; credit: number | null } | null;
    netTcg: number | null;
    decision: Decision;
    flags: string[];
  };

  const work: Work[] = items.map((item) => {
    const flags: string[] = [];
    if (item.productId === null) flags.push("unmatched");
    if (item.marketPrice === null) flags.push("no market price");
    if (item.category === "sealed") flags.push("sealed");
    if (item.marketPrice !== null && item.marketPrice >= eco.high_value_flag) {
      flags.push("high value — verify");
    }

    // Best offer = highest condition-adjusted cash (fall back to credit-only
    // vendors when nobody pays cash).
    let best: Work["best"] = null;
    for (const offer of item.offers) {
      if (!offer.buying) continue;
      const adj = adjustOffer(offer, item.condition, multipliers);
      const score = adj.cash ?? (adj.credit !== null ? adj.credit * 0.7 : null);
      if (score === null || score < eco.buylist_min_offer) continue;
      const bestScore =
        best === null
          ? -1
          : (best.cash ?? (best.credit !== null ? best.credit * 0.7 : -1));
      if (score > bestScore) {
        best = { offer, cash: adj.cash, credit: adj.credit };
      }
    }

    const netTcg =
      item.marketPrice !== null
        ? netTcgUnit(item.marketPrice, item.condition, eco, multipliers)
        : null;

    // Vendor buylists occasionally publish glitched prices (observed live:
    // a $375 offer on a $68 card). Could be free money if honored — but
    // usually means a repriced/rejected submission, so warn loudly.
    if (
      best?.cash != null &&
      item.marketPrice !== null &&
      best.cash > 5 &&
      best.cash > item.marketPrice * 1.5
    ) {
      flags.push("offer ≫ market — verify");
    }

    return { item, best, netTcg, decision: "BULK" as Decision, flags };
  });

  // Initial decisions ignoring shipping, then iterate amortization.
  const shippingShare = new Map<string, number>(); // vendor -> per-card dollars
  for (let pass = 0; pass < 10; pass++) {
    for (const w of work) {
      w.decision = decideOne(w, eco, shippingShare);
    }
    const batches = new Map<string, number>();
    for (const w of work) {
      if (w.decision === "BUYLIST" && w.best) {
        const v = w.best.offer.vendor;
        batches.set(v, (batches.get(v) ?? 0) + w.item.quantity);
      }
    }
    const next = new Map<string, number>();
    for (const [vendor, cards] of batches) {
      next.set(vendor, eco.buylist_shipping_flat / cards);
    }
    const stable =
      next.size === shippingShare.size &&
      [...next].every(([v, s]) => Math.abs((shippingShare.get(v) ?? -1) - s) < 0.001);
    shippingShare.clear();
    for (const [v, s] of next) shippingShare.set(v, s);
    if (stable) break;
  }

  const results: ItemResult[] = work.map((w) => ({
    item: w.item,
    estSalePrice:
      w.item.marketPrice !== null
        ? toDollars(
            Math.round(
              toCents(w.item.marketPrice) *
                conditionMultiplier(
                  multipliers,
                  "singles",
                  w.item.condition ?? "NM",
                ),
            ),
          )
        : null,
    decision: w.decision,
    bestOffer: w.best
      ? {
          vendor: w.best.offer.vendor,
          cash: w.best.cash,
          credit: w.best.credit,
          url: w.best.offer.url,
        }
      : null,
    netBuylist:
      w.best?.cash != null
        ? toDollars(
            toCents(w.best.cash) -
              toCents(shippingShare.get(w.best.offer.vendor) ?? 0),
          )
        : null,
    netTcg: w.netTcg,
    netBulk: eco.bulk_rate_per_card,
    flags: w.flags,
  }));

  const totals = { buylistCash: 0, buylistCredit: 0, tcgNet: 0, bulk: 0, cards: 0 };
  const vendorBatches: AnalyzerSummary["vendorBatches"] = {};
  for (const r of results) {
    const qty = r.item.quantity;
    totals.cards += qty;
    if (r.decision === "BUYLIST" && r.bestOffer) {
      totals.buylistCash += (r.bestOffer.cash ?? 0) * qty;
      totals.buylistCredit += (r.bestOffer.credit ?? 0) * qty;
      const b = (vendorBatches[r.bestOffer.vendor] ??= {
        cards: 0,
        cash: 0,
        credit: 0,
        shipping: eco.buylist_shipping_flat,
      });
      b.cards += qty;
      b.cash += (r.bestOffer.cash ?? 0) * qty;
      b.credit += (r.bestOffer.credit ?? 0) * qty;
    } else if (r.decision === "TCG") {
      totals.tcgNet += (r.netTcg ?? 0) * qty;
    } else {
      totals.bulk += eco.bulk_rate_per_card * qty;
    }
  }
  round2(totals);
  for (const b of Object.values(vendorBatches)) round2(b);

  return { results, totals, vendorBatches };

  function decideOne(
    w: Work,
    eco: AnalyzerEconomics,
    shipping: Map<string, number>,
  ): Decision {
    const market = w.item.marketPrice;
    // Sealed product never goes to the bulk pile — sell it (TCGplayer here;
    // realistically Whatnot/FB, but the net math is a sane floor either way).
    if (w.item.category === "sealed") {
      return w.netTcg !== null ? "TCG" : "BULK";
    }
    if (market !== null && market < eco.bulk_market_threshold && !w.best) {
      return "BULK";
    }
    const netBuylist =
      w.best?.cash != null
        ? w.best.cash - (shipping.get(w.best.offer.vendor) ?? 0)
        : null;
    const netTcg = w.netTcg;
    const candidates: [Decision, number][] = [];
    if (netBuylist !== null) candidates.push(["BUYLIST", netBuylist]);
    if (netTcg !== null) candidates.push(["TCG", netTcg]);
    candidates.push(["BULK", eco.bulk_rate_per_card]);
    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0][0];
  }

  function round2(obj: Record<string, number>) {
    for (const k of Object.keys(obj)) obj[k] = Math.round(obj[k] * 100) / 100;
  }
}
