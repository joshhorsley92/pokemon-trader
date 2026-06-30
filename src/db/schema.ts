import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const productCategory = pgEnum("product_category", [
  "singles",
  "sealed",
  "graded",
]);

export const rateType = pgEnum("rate_type", ["store_credit", "cash"]);

export const ruleScope = pgEnum("rule_scope", ["category", "set", "product"]);

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "under_review",
  "countered",
  "accepted",
  "declined",
  "expired",
  "completed",
]);

export const inventoryStatus = pgEnum("inventory_status", [
  "available",
  "reserved",
  "sold",
  "hidden",
]);

// A booth/show session groups every on-the-spot buy & sell so the day can be
// reconciled and exported at the end. See src/lib/show.ts.
export const showSessionStatus = pgEnum("show_session_status", [
  "open",
  "closed",
]);

// What a counter line did: 'buy' = the shop acquired cards (paid cash/credit);
// 'sell' = the shop sold cards out of the case.
export const showTxnKind = pgEnum("show_txn_kind", ["buy", "sell"]);

// A customer-built booth trade (scanned the session QR) and its lines move
// through this lifecycle as the operator works the pile.
export const showPendingStatus = pgEnum("show_pending_status", [
  "pending",
  "accepted",
  "dismissed",
]);

// Which side of the trade a pending line sits on: 'give' = card the customer
// is handing over (becomes a buy); 'want' = a case item they want (a sell).
export const showPendingSide = pgEnum("show_pending_side", ["give", "want"]);

// ===== Tenancy (one row per installed shop) =====
//
// The catalog/buylist tables below stay GLOBAL — they're source-of-truth
// reference data identical for every shop. Everything a shop configures or
// owns (settings, pricing rules, hot buys, inventory, submissions) carries a
// shopId. `platform` is text, not an enum, so adding Square/Lightspeed never
// needs a migration (mirrors the buylist `vendor` choice).

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 'standalone' | 'shopify' | 'square' | 'lightspeed' — selects the
  // CommerceAdapter (see src/lib/commerce). Defaults to standalone until a
  // platform is connected.
  platform: text("platform").notNull().default("standalone"),
  // Platform-native shop id (the *.myshopify.com domain for Shopify); unique
  // per platform, null for standalone.
  platformShopId: text("platform_shop_id"),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active | suspended | uninstalled
  // Pricing-data source for this shop (see src/lib/pricing-data). Global
  // 'tcgcsv' for now; per-shop licensed providers later.
  dataProvider: text("data_provider").notNull().default("tcgcsv"),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
  uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex("uniq_shop_platform_id")
    .on(t.platform, t.platformShopId)
    .where(sql`${t.platformShopId} IS NOT NULL`),
]);

// Per-platform OAuth/offline token for acting on a shop's behalf. One row per
// shop; the token is encrypted at rest by the app before insert.
export const shopSessions = pgTable("shop_sessions", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = offline token
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Who may administer which shop. Bridges the existing email/password
// admin_users to shops; Shopify staff identity also provisions rows here.
export const shopUsers = pgTable(
  "shop_users",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // owner | staff
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.adminUserId] })],
);

// Per-shop replacement for the global key-value `settings` table.
export const shopSettings = pgTable(
  "shop_settings",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.key] })],
);

// ===== Catalog (mirrored from TCGCSV) =====

export const catalogGroups = pgTable("catalog_groups", {
  id: integer("id").primaryKey(), // tcgplayer groupId, natural key
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  publishedOn: date("published_on"),
  modifiedOn: text("modified_on"), // raw TCGCSV timestamp, used for delta skipping
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: integer("id").primaryKey(), // tcgplayer productId, natural key
    groupId: integer("group_id")
      .notNull()
      .references(() => catalogGroups.id),
    name: text("name").notNull(),
    cleanName: text("clean_name"),
    category: productCategory("category").notNull(),
    categoryOverride: productCategory("category_override"),
    imageUrl: text("image_url"),
    tcgplayerUrl: text("tcgplayer_url"),
    extData: jsonb("ext_data"),
    marketPrice: numeric("market_price", { precision: 10, scale: 2 }),
    lowPrice: numeric("low_price", { precision: 10, scale: 2 }),
    // All TCGplayer printing variants for this card, ordered with the headline
    // (the one mirrored into market_price) first. Lets the customer pick the
    // exact printing — "1st Edition Holofoil", "Reverse Holofoil", etc. — and
    // price against it. Shape: [{ subType, market, low }]. Null/[] for products
    // with a single printing (most sealed).
    printings: jsonb("printings"),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_products_group").on(t.groupId),
    index("idx_products_cat")
      .on(t.category)
      .where(sql`${t.marketPrice} IS NOT NULL`),
    index("idx_products_name_search").using(
      "gin",
      sql`to_tsvector('simple', ${t.name})`,
    ),
  ],
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => catalogProducts.id),
    snapshotDate: date("snapshot_date").notNull(),
    marketPrice: numeric("market_price", { precision: 10, scale: 2 }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.snapshotDate] })],
);

// ===== Vendor buylists (what other stores PAY for singles) =====

export const buylistPrices = pgTable(
  "buylist_prices",
  {
    // 'card_cavern' | 'full_grip' | 'coolstuff' — text, not enum, so adding a
    // vendor never needs a migration
    vendor: text("vendor").notNull(),
    // Vendor's stable identifier for the listing (Shopify product id,
    // Crystal Commerce listing id) — the upsert key alongside vendor.
    vendorKey: text("vendor_key").notNull(),
    // Matched TCGplayer product; null when the matcher couldn't resolve the
    // listing, kept so we can measure and improve match rate.
    productId: integer("product_id").references(() => catalogProducts.id),
    listingTitle: text("listing_title").notNull(), // raw vendor title, for match auditing
    setName: text("set_name"),
    cardNumber: text("card_number"),
    printing: text("printing"), // vendor's printing label (Holo, Reverse Holo, ...)
    cashPrice: numeric("cash_price", { precision: 10, scale: 2 }), // NM cash
    creditPrice: numeric("credit_price", { precision: 10, scale: 2 }), // NM store credit
    // Full condition ladder where the vendor publishes one, e.g.
    // {"NM": 2.51, "LP": 2.26, "MP": 1.76, "HP": 1.51}
    conditionPrices: jsonb("condition_prices"),
    buying: boolean("buying").notNull().default(true),
    vendorUrl: text("vendor_url"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.vendor, t.vendorKey] }),
    index("idx_buylist_product").on(t.productId),
  ],
);

export const buylistSyncRuns = pgTable("buylist_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendor: text("vendor").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | success | failed
  listingsSeen: integer("listings_seen").notNull().default(0),
  listingsMatched: integer("listings_matched").notNull().default(0),
  error: text("error"),
});

// ===== Pricing rules =====

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    scope: ruleScope("scope").notNull(),
    rateType: rateType("rate_type").notNull().default("store_credit"),
    category: productCategory("category"), // required when scope='category'
    groupId: integer("group_id").references(() => catalogGroups.id),
    productId: integer("product_id").references(() => catalogProducts.id),
    percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
    // Product-scope only: pay this flat dollar amount per unit instead of a
    // percentage of market (condition multipliers still apply).
    flatAmount: numeric("flat_amount", { precision: 10, scale: 2 }),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // Per-shop uniqueness: two shops may hold the same rule target.
    uniqueIndex("uniq_pricing_rule_target")
      .on(t.shopId, t.scope, t.rateType, t.category, t.groupId, t.productId)
      .where(sql`${t.active} = true`),
    index("idx_pricing_rules_shop").on(t.shopId),
  ],
);

// ===== Hot buys: products we're actively hunting — customers get bonus credit =====

export const hotBuys = pgTable(
  "hot_buys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => catalogProducts.id),
    // Percentage points added to the applied trade-in percentage
    // (e.g. 85% default + 10 bonus = 95% of market)
    bonusPercent: numeric("bonus_percent", { precision: 5, scale: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_hot_buy_product")
      .on(t.shopId, t.productId)
      .where(sql`${t.active} = true`),
    index("idx_hot_buys_shop").on(t.shopId),
  ],
);

// ===== Shop inventory (what customers trade FOR) =====

export const inventoryItems = pgTable(
  "inventory_items",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => catalogProducts.id), // nullable: unmatched CSV rows
  title: text("title").notNull(),
  category: productCategory("category").notNull(),
  condition: text("condition"), // NM/LP/MP later; null for sealed
  quantity: integer("quantity").notNull().default(1),
  // null = track market price (x markup setting); set = fixed asking price
  askingPrice: numeric("asking_price", { precision: 10, scale: 2 }),
  photoUrl: text("photo_url"),
  status: inventoryStatus("status").notNull().default("available"),
  source: text("source").notNull().default("manual"), // 'manual' | 'collectr_csv'
  sourceData: jsonb("source_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_inventory_shop").on(t.shopId)],
);

// ===== Admin =====

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
});

// ===== Submissions =====

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  publicToken: text("public_token").unique().notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  rateType: rateType("rate_type").notNull().default("store_credit"),
  status: submissionStatus("status").notNull().default("pending"),
  tradeInTotal: numeric("trade_in_total", { precision: 10, scale: 2 }).notNull(),
  tradeForTotal: numeric("trade_for_total", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  counterTotal: numeric("counter_total", { precision: 10, scale: 2 }),
  // Customer opted to take the leftover credit as cash, valued at the cash
  // rate: leftover × (cash quote ÷ credit quote), snapshotted at submit.
  takeCashRemainder: boolean("take_cash_remainder").notNull().default(false),
  remainderCashValue: numeric("remainder_cash_value", {
    precision: 10,
    scale: 2,
  }),
  quoteExpiresAt: timestamp("quote_expires_at", {
    withTimezone: true,
  }).notNull(),
  customerMessage: text("customer_message"),
  adminNotes: text("admin_notes"),
  reviewedBy: uuid("reviewed_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => [index("idx_submissions_shop").on(t.shopId)]);

export const submissionTradeInItems = pgTable("submission_trade_in_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  productId: integer("product_id")
    .notNull()
    .references(() => catalogProducts.id),
  productName: text("product_name").notNull(), // snapshot, survives catalog changes
  // TCGplayer printing/edition the customer selected (e.g. "1st Edition
  // Holofoil", "Reverse Holofoil"). Null = the product's default printing.
  printing: text("printing"),
  condition: text("condition"), // e.g. "Perfect" (sealed) or "NM" (singles)
  // Graded slabs: not auto-priced (free price data can't value slabs), so
  // these carry the grader + grade and are quoted manually by an admin. The
  // numeric price columns are 0 on a graded line until the admin sets a counter.
  graded: boolean("graded").notNull().default(false),
  grader: text("grader"), // PSA | CGC | BGS | TAG | SGC | Other
  grade: text("grade"), // "10", "9.5", … or free text for "Other"
  conditionMultiplier: numeric("condition_multiplier", {
    precision: 4,
    scale: 3,
  })
    .notNull()
    .default("1"),
  quantity: integer("quantity").notNull(),
  unitMarketPrice: numeric("unit_market_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  appliedPercentage: numeric("applied_percentage", {
    precision: 5,
    scale: 2,
  }).notNull(),
  appliedRuleId: uuid("applied_rule_id").references(() => pricingRules.id),
  hotBuyBonus: numeric("hot_buy_bonus", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  unitCredit: numeric("unit_credit", { precision: 10, scale: 2 }).notNull(),
  counterUnitCredit: numeric("counter_unit_credit", {
    precision: 10,
    scale: 2,
  }),
});

// Customer photos of their trade-in items, compressed client-side and stored
// inline — no external storage dependency at this volume.
export const submissionPhotos = pgTable("submission_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const submissionTradeForItems = pgTable("submission_trade_for_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  itemTitle: text("item_title").notNull(), // snapshot
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
});

// ===== Show mode: on-the-spot booth buying & selling =====
//
// A session is one day/event. Each transaction is a single buy or sell line;
// the log is the source of truth for end-of-show reconciliation and inventory
// effects are derived from it. Staff-operated (admin-authed), so prices may be
// computed by the engine OR overridden by hand (manualPrice).

export const showSessions = pgTable(
  "show_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: showSessionStatus("status").notNull().default("open"),
    // Unguessable token encoded in the booth QR so customers can self-build
    // trades into THIS session. Rotated by opening a new session.
    joinToken: text("join_token").unique(),
    openedBy: uuid("opened_by").references(() => adminUsers.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("idx_show_sessions_shop").on(t.shopId)],
);

export const showTransactions = pgTable(
  "show_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => showSessions.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    kind: showTxnKind("kind").notNull(),
    // Nullable: a hand-typed line (e.g. a graded slab) need not match catalog.
    productId: integer("product_id").references(() => catalogProducts.id),
    title: text("title").notNull(), // snapshot, survives catalog changes
    category: productCategory("category").notNull(),
    condition: text("condition"),
    printing: text("printing"),
    quantity: integer("quantity").notNull().default(1),
    // Buys only: what the payout was in (cash | store_credit). Null for sells.
    rateType: rateType("rate_type"),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull(),
    manualPrice: boolean("manual_price").notNull().default(false),
    // Buys only: 'queued' (logged, add to inventory later) | 'added' (now live
    // stock). Null for sells.
    inventoryAction: text("inventory_action"),
    // The inventory row this line created (buy→added) or drew down (sell).
    inventoryItemId: uuid("inventory_item_id").references(
      () => inventoryItems.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_show_txn_session").on(t.sessionId),
    index("idx_show_txn_shop").on(t.shopId),
  ],
);

// A customer-built trade waiting at the counter. The operator reviews it and
// accepts lines (each give → a buy txn, each want → a sell txn) into the
// session, or dismisses it. Kept separate from show_transactions so a pending
// pile never touches inventory or the running tally until accepted.
export const showPendingTrades = pgTable(
  "show_pending_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => showSessions.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    label: text("label"), // customer's first name, optional
    rateType: rateType("rate_type").notNull().default("store_credit"),
    status: showPendingStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_show_pending_session").on(t.sessionId)],
);

export const showPendingItems = pgTable(
  "show_pending_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pendingId: uuid("pending_id")
      .notNull()
      .references(() => showPendingTrades.id, { onDelete: "cascade" }),
    side: showPendingSide("side").notNull(),
    // 'give' lines carry a catalog product; 'want' lines carry an inventory
    // item the customer picked from the case.
    productId: integer("product_id").references(() => catalogProducts.id),
    inventoryItemId: uuid("inventory_item_id").references(
      () => inventoryItems.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    category: productCategory("category").notNull(),
    condition: text("condition"),
    printing: text("printing"),
    quantity: integer("quantity").notNull().default(1),
    // Graded slabs can't be auto-priced (free data can't value them); the flag
    // survives the booth boundary so the operator quotes them by hand instead
    // of the engine silently pricing the slab as a raw card.
    graded: boolean("graded").notNull().default(false),
    grader: text("grader"),
    grade: text("grade"),
    status: showPendingStatus("status").notNull().default("pending"),
  },
  (t) => [index("idx_show_pending_items_pending").on(t.pendingId)],
);

// ===== Ops =====

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | success | failed
  groupsProcessed: integer("groups_processed").notNull().default(0),
  productsUpserted: integer("products_upserted").notNull().default(0),
  error: text("error"),
});

export const submissionRateLimits = pgTable(
  "submission_rate_limits",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.ip, t.windowStart] })],
);
