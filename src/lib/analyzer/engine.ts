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
  resolveSinglesMultiplier,
  type ConditionCurve,
} from "@/lib/condition-curve";
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
  /**
   * Printing this offer is for, as the vendor labels it ("Reverse Foil",
   * "Holo", null when they don't distinguish). Gates which card it can price —
   * see offerMatchesPrinting.
   */
  printing?: string | null;
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
  /**
   * Current lowest live listing, dollars. Market price is a trailing average
   * of completed sales and on vintage often sits far above what's actually
   * for sale (Base Set Chansey: market $65.45 vs $20.99 lowest ask), so the
   * realistic sale estimate is capped here — you can't sell above the cheapest
   * competing copy. ~24h stale (TCGCSV daily mirror), like every price here.
   */
  lowPrice?: number | null;
  /**
   * Real per-condition prices for this card's printing, when we have them
   * (JustTCG SKU data). condition -> price, e.g. {NM: 65.45, LP: 25.80,
   * MP: 15.64, HP: 9.24, Damaged: 7.93}. Beats every estimate: the sale price
   * is read straight off it, and the NM ratio replaces the era curve when
   * discounting vendor buylist offers.
   */
  conditionLadder?: Record<string, number> | null;
  /** Sealed product (ETB, collection box, ...) — no buylists, never bulk */
  category?: "singles" | "sealed";
  // Export metadata (vendor pick lists, TCGplayer import CSV) — passed
  // through untouched by the engine.
  cardNumber?: string | null;
  rarity?: string | null;
  printing?: string | null;
  /**
   * Set release year — picks the era rung on the condition curve. Vintage
   * cards lose far more value off-condition than modern ones, so without this
   * the flat ladder wildly overvalues played WOTC cards.
   */
  releaseYear?: number | null;
  /** Real TCGplayer product id only (never synthetic) — import CSV column */
  tcgplayerId?: number | null;
  // UI passthrough (manual analyzer): link to check the live listing, and the
  // printings the operator can switch between to reprice. Ignored by the math.
  tcgUrl?: string | null;
  availablePrintings?: { subType: string; market: number | null }[] | null;
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

/** Local copies so this module keeps its no-import purity (see tcgcsv.ts). */
const FIRST_EDITION_RE = /\b(?:1st|first)\s*edition\b/i;
/** Any explicit edition call, so a stated "Unlimited" isn't nagged about. */
const EDITION_STATED_RE = /\b(?:1st|first)\s*edition\b|\bunlimited\b/i;

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
  /** Pre-resolved condition ratio (era curve). Falls back to the flat table. */
  multiplierOverride?: number,
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
  const mult =
    multiplierOverride ?? conditionMultiplier(multipliers, "singles", cond);
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

/**
 * Reduce a printing label to a comparable bucket. Our catalog uses TCGplayer
 * subtypes ("Normal", "Holofoil", "Reverse Holofoil", "1st Edition Holofoil");
 * vendors use their own words ("Reverse Foil", "Holo", "NON-HOLO", "Poke Ball
 * Foil"). Anything unrecognized returns its cleaned text so distinct specials
 * (Master Ball vs Poke Ball foil) stay distinct instead of collapsing together.
 */
export function printingBucket(
  printing: string | null | undefined,
): string | null {
  if (!printing) return null;
  const p = printing.trim().toLowerCase();
  if (!p) return null;
  // Order matters: "reverse holofoil" must not be read as plain holo.
  if (/reverse/.test(p)) return "reverse";
  if (/master\s*ball/.test(p)) return "masterball";
  if (/poke\s*ball/.test(p)) return "pokeball";
  if (/non-?\s*holo/.test(p) || /^normal\b/.test(p) || /unlimited normal/.test(p))
    return "normal";
  if (/holo|foil/.test(p)) return "holo";
  return p;
}

/**
 * Should this vendor offer be used to price this card's printing?
 *
 * Vendors list each printing as its own buylist entry at very different prices
 * (a Reverse Holo can be 20x the Normal). Matching purely on product id used
 * the best of ALL printings, which massively overvalued plain cards. Rules:
 *  - vendor didn't say (null printing, e.g. Full Grip) -> keep, best effort
 *  - we don't know our card's printing -> keep, can't discriminate
 *  - both known -> keep only when the buckets agree
 */
export function offerMatchesPrinting(
  offerPrinting: string | null | undefined,
  itemPrinting: string | null | undefined,
): boolean {
  const offer = printingBucket(offerPrinting);
  if (offer === null) return true;
  const item = printingBucket(itemPrinting);
  if (item === null) return true;
  return offer === item;
}

/** Per-unit net proceeds of a TCGplayer market-price sale. */
export function netTcgUnit(
  marketPrice: number,
  condition: string | null | undefined,
  eco: AnalyzerEconomics,
  multipliers: ConditionMultipliers,
  /** Pre-resolved condition ratio (era curve). Falls back to the flat table. */
  multiplierOverride?: number,
): number {
  const mult =
    multiplierOverride ??
    conditionMultiplier(multipliers, "singles", condition ?? "NM");
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
  /**
   * Era/value condition curve — the same one the customer quote uses. When
   * supplied, singles price off it instead of the flat ladder, which overpaid
   * played vintage badly (Base Set MP was valued at 0.70 of NM vs ~0.32 real).
   */
  curve?: ConditionCurve,
): AnalyzerSummary {
  type Work = {
    item: AnalyzerItem;
    best: { offer: VendorOffer; cash: number | null; credit: number | null } | null;
    netTcg: number | null;
    decision: Decision;
    flags: string[];
    /** Resolved condition ratio for this card (curve when available). */
    condMult: number;
    /** Condition-adjusted sale price, capped at the lowest live listing. */
    estSale: number | null;
  };

  const work: Work[] = items.map((item) => {
    const flags: string[] = [];
    if (item.productId === null) flags.push("unmatched");
    if (item.marketPrice === null) flags.push("no market price");
    if (item.category === "sealed") flags.push("sealed");
    if (item.marketPrice !== null && item.marketPrice >= eco.high_value_flag) {
      flags.push("high value — verify");
    }
    // An unspecified vintage card is priced as Unlimited (see pickPrice) —
    // safe against overpaying, but it would underpay a genuine 1st Edition.
    // Surface the choice instead of silently making it.
    const printings = item.availablePrintings ?? [];
    if (
      !EDITION_STATED_RE.test(item.printing ?? "") &&
      printings.some((p) => FIRST_EDITION_RE.test(p.subType)) &&
      printings.some((p) => !FIRST_EDITION_RE.test(p.subType))
    ) {
      flags.push("edition matters — confirm 1st Ed vs Unlimited");
    }

    // Best offer = highest condition-adjusted cash (fall back to credit-only
    // vendors when nobody pays cash).
    // One condition ratio per card, shared by the buylist and TCG math. The
    // era curve needs the card's own market price and release year, so it
    // can't be hoisted out of the loop.
    // Real measured ratio when we have per-condition prices, else the curve.
    // ladder[cond]/ladder.NM is the market's own answer to "what does played
    // cost?", so it retires the estimate for that card.
    const ladder = item.conditionLadder ?? null;
    const cond = item.condition ?? "NM";
    const ladderMult =
      ladder && ladder.NM && ladder.NM > 0 && ladder[cond] !== undefined
        ? ladder[cond] / ladder.NM
        : undefined;
    const condMult =
      ladderMult ??
      (curve && item.category !== "sealed"
        ? resolveSinglesMultiplier(
            curve,
            item.condition,
            item.releaseYear,
            item.marketPrice ?? 0,
          ).multiplier
        : undefined);

    let best: Work["best"] = null;
    for (const offer of item.offers) {
      if (!offer.buying) continue;
      // Only price against offers for THIS printing — a vendor's Reverse Holo
      // entry must not set the price for a Normal copy.
      if (!offerMatchesPrinting(offer.printing, item.printing)) continue;
      const adj = adjustOffer(offer, item.condition, multipliers, condMult);
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

    // Realistic sale price: market discounted for condition, then capped at
    // the cheapest live listing — you can't sell above the competition.
    const condAdjusted =
      item.marketPrice !== null
        ? item.marketPrice *
          (condMult ??
            conditionMultiplier(multipliers, "singles", item.condition ?? "NM"))
        : null;
    // A real listed price for this exact condition needs no estimating and no
    // low-ask cap — it IS what the card sells for.
    // Sale price = TCGCSV market × the condition ratio. NM therefore always
    // lands exactly on TCGCSV's market price (ratio 1), which is refreshed
    // nightly for the whole catalog and free; the played rungs come from the
    // per-condition source as a RATIO rather than an absolute, so a cached
    // ladder that's a few days old still tracks a moving market.
    //
    // item.lowPrice is deliberately NOT used here. It's one number for the
    // whole printing with no condition attached, so it can't act as a
    // per-condition ceiling: Ninetales BS2's $16.99 low sits between its real
    // LP ($18.28) and MP ($14.30) while NM is $32.99 — capping with it made NM
    // read $16.99 and simultaneously overvalued played copies. The field stays
    // plumbed for the day we get SKU-level (per-condition) lows, at which
    // point min(conditionMarket, conditionLow) becomes the right rule.
    const estSale = condAdjusted;
    // Multiplier already applied above, so price the net off estSale directly.
    const netTcg =
      estSale !== null
        ? netTcgUnit(estSale, item.condition, eco, multipliers, 1)
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

    return {
      item,
      best,
      netTcg,
      decision: "BULK" as Decision,
      flags,
      condMult:
        condMult ??
        conditionMultiplier(multipliers, "singles", item.condition ?? "NM"),
      estSale,
    };
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
      w.estSale !== null ? toDollars(Math.round(toCents(w.estSale))) : null,
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
