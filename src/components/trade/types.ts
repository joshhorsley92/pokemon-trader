export type PrintingOption = {
  subType: string;
  market: number | null;
  low: number | null;
};

export type CatalogHit = {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  imageUrl: string | null;
  marketPrice: number | null;
  /** Card number like "041/094" — singles only; helps spot wrong matches */
  cardNumber?: string | null;
  // Drives which condition scale (sealed packaging vs card grades) the trade
  // builder shows for this item.
  category: "singles" | "sealed" | "graded";
  // Available TCGplayer printings/editions, headline-first. Empty/1 entry =
  // no printing choice to make.
  printings: PrintingOption[];
  // Search-only: this card's market price is below the trade-in floor for its
  // category, so it's shown disabled. `floor` is that threshold in dollars.
  belowFloor?: boolean;
  floor?: number;
};

export type TradeInLine = {
  product: CatalogHit;
  quantity: number;
  condition: string;
  /** Chosen printing subType; null = product default (printings[0]) */
  printing: string | null;
  graded: boolean;
  grader: string | null;
  grade: string | null;
};

export type ShopItem = {
  id: string;
  title: string;
  category: "singles" | "sealed" | "graded";
  condition: string | null;
  quantity: number;
  price: number;
  photoUrl: string | null;
  imageUrl: string | null;
};

export type WantLine = {
  item: ShopItem;
  quantity: number;
};

export type QuoteLineDto = {
  productId: number;
  productName: string;
  printing: string | null;
  condition: string | null;
  conditionMultiplier: number;
  quantity: number;
  unitMarketPrice: number;
  appliedPercentage: number;
  hotBuyBonus: number;
  unitCredit: number;
  lineCredit: number;
};

export type ManualLineDto = {
  productId: number;
  productName: string;
  printing: string | null;
  grader: string | null;
  grade: string | null;
  quantity: number;
};

export type HotBuyDto = {
  productId: number;
  name: string;
  groupId: number;
  groupName: string;
  imageUrl: string | null;
  marketPrice: number | null;
  category: "singles" | "sealed" | "graded";
  printings: PrintingOption[];
  bonusPercent: number;
  notes: string | null;
};

export type QuoteDto = {
  rateType: "store_credit" | "cash";
  lines: QuoteLineDto[];
  manualLines?: ManualLineDto[];
  total: number;
  totals?: { store_credit: number; cash: number };
};

// ===== Customer list import =====

export type BulkCardDto = {
  productId: number;
  name: string;
  setName: string | null;
  quantity: number;
  marketPrice: number | null;
};

/** Below-floor cards from a list import, paid flat per 1,000 cards. */
export type BulkLot = {
  cards: BulkCardDto[];
  ratePerThousand: number;
};

export type ImportResultDto = {
  regular: {
    product: CatalogHit;
    quantity: number;
    condition: string;
    printing: string | null;
  }[];
  bulk: BulkLot;
  rejected: { raw: string; reason: string }[];
  parsedCount: number;
  matchedCount: number;
};

export function bulkLotCount(lot: BulkLot | null): number {
  return lot ? lot.cards.reduce((sum, c) => sum + c.quantity, 0) : 0;
}

export function bulkLotTotal(lot: BulkLot | null): number {
  if (!lot) return 0;
  return (
    Math.round((bulkLotCount(lot) * lot.ratePerThousand) / 1000 * 100) / 100
  );
}

export function bulkRateLabel(ratePerThousand: number): string {
  return `$${ratePerThousand.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} per 1,000`;
}
