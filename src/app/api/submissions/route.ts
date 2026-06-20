import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, tables } from "@/db";
import { sendOwnerNewSubmission } from "@/lib/email";
import { effectiveInventoryPrice } from "@/lib/inventory";
import { applyRounding, toMoneyString } from "@/lib/pricing";
import { quoteFromDb } from "@/lib/quote";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const submissionSchema = z.object({
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email().max(200),
  customerPhone: z.string().max(40).optional().default(""),
  customerMessage: z.string().max(2000).optional().default(""),
  rateType: z.enum(["store_credit", "cash"]),
  tradeInItems: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
        condition: z.string().max(40).optional(),
        printing: z.string().max(60).nullish(),
        graded: z.boolean().optional(),
        grader: z.string().max(20).nullish(),
        grade: z.string().max(20).nullish(),
      }),
    )
    .min(1)
    .max(50),
  tradeForItems: z
    .array(
      z.object({
        inventoryItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(50),
  takeCashRemainder: z.boolean().optional().default(false),
  // Compressed JPEG data URLs from the client (≤3, each ≤600KB decoded)
  photos: z
    .array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/))
    .max(3)
    .optional()
    .default([]),
  // Anti-spam
  website: z.string().max(0).optional().default(""), // honeypot — must stay empty
  startedAt: z.number(), // ms epoch when the form was opened
});

const MAX_PHOTO_BYTES = 600 * 1024;

function decodePhoto(
  dataUrl: string,
): { contentType: string; data: Buffer } | null {
  const comma = dataUrl.indexOf(",");
  const contentType = dataUrl.slice(5, dataUrl.indexOf(";"));
  const data = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) return null;
  return { contentType, data };
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const body = await request.json().catch(() => null);
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }
  const data = parsed.data;

  // Honeypot filled or form submitted suspiciously fast → pretend success
  if (data.website !== "" || Date.now() - data.startedAt < 3000) {
    return NextResponse.json({ token: nanoid(21) });
  }

  const shopId = await getCurrentShopId();

  const photos = data.photos
    .map(decodePhoto)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (!(await checkRateLimit(shopId, ip))) {
    return NextResponse.json(
      { error: "Too many submissions — please try again later." },
      { status: 429 },
    );
  }

  const settings = await getSettings(shopId);

  // Server-side re-quote: never trust client totals.
  let quote;
  try {
    quote = await quoteFromDb(data.tradeInItems, data.rateType, settings, shopId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not price items" },
      { status: 400 },
    );
  }

  // Price the requested inventory items server-side too.
  const wantedIds = data.tradeForItems.map((i) => i.inventoryItemId);
  const inventoryRows =
    wantedIds.length > 0
      ? await db
          .select({
            id: tables.inventoryItems.id,
            title: tables.inventoryItems.title,
            status: tables.inventoryItems.status,
            askingPrice: tables.inventoryItems.askingPrice,
            marketPrice: tables.catalogProducts.marketPrice,
          })
          .from(tables.inventoryItems)
          .leftJoin(
            tables.catalogProducts,
            eq(tables.catalogProducts.id, tables.inventoryItems.productId),
          )
          .where(
            and(
              eq(tables.inventoryItems.shopId, shopId),
              inArray(tables.inventoryItems.id, wantedIds),
            ),
          )
      : [];
  const inventoryById = new Map(inventoryRows.map((r) => [r.id, r]));

  const tradeForLines: {
    inventoryItemId: string;
    itemTitle: string;
    quantity: number;
    unitPrice: number;
  }[] = [];
  for (const want of data.tradeForItems) {
    const row = inventoryById.get(want.inventoryItemId);
    if (!row || row.status !== "available") {
      return NextResponse.json(
        { error: "One of the requested items is no longer available." },
        { status: 400 },
      );
    }
    const priced = effectiveInventoryPrice(
      row.askingPrice === null ? null : Number(row.askingPrice),
      row.marketPrice === null ? null : Number(row.marketPrice),
      settings.inventory_market_markup,
    );
    if (!priced) {
      return NextResponse.json(
        { error: "One of the requested items is not currently priced." },
        { status: 400 },
      );
    }
    tradeForLines.push({
      inventoryItemId: want.inventoryItemId,
      itemTitle: row.title,
      quantity: want.quantity,
      unitPrice: priced.price,
    });
  }
  const tradeForTotal =
    tradeForLines.reduce(
      (sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity,
      0,
    ) / 100;

  // Leftover credit taken as cash is valued at the cash rate:
  // leftover × (cash quote ÷ credit quote). Recomputed here — never trusted
  // from the client.
  const leftover = Math.round((quote.total - tradeForTotal) * 100) / 100;
  const takeCashRemainder =
    data.takeCashRemainder &&
    data.rateType === "store_credit" &&
    tradeForLines.length > 0 &&
    leftover > 0;
  let remainderCashValue: number | null = null;
  if (takeCashRemainder) {
    const cashQuote = await quoteFromDb(
      data.tradeInItems,
      "cash",
      settings,
      shopId,
    );
    remainderCashValue =
      quote.total > 0
        ? applyRounding((cashQuote.total * leftover) / quote.total, settings)
        : 0;
  }

  const publicToken = nanoid(21);
  const quoteExpiresAt = new Date(
    Date.now() + settings.quote_validity_days * 24 * 3600 * 1000,
  );

  const submissionId = await db.transaction(async (tx) => {
    const [submission] = await tx
      .insert(tables.submissions)
      .values({
        shopId,
        publicToken,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone || null,
        customerMessage: data.customerMessage || null,
        rateType: data.rateType,
        tradeInTotal: toMoneyString(quote.total),
        tradeForTotal: toMoneyString(tradeForTotal),
        takeCashRemainder,
        remainderCashValue:
          remainderCashValue === null
            ? null
            : toMoneyString(remainderCashValue),
        quoteExpiresAt,
      })
      .returning({ id: tables.submissions.id });

    const rawRows = quote.lines.map((line) => ({
      submissionId: submission.id,
      productId: line.productId,
      productName: line.productName,
      printing: line.printing,
      condition: line.condition,
      conditionMultiplier: line.conditionMultiplier.toFixed(3),
      quantity: line.quantity,
      unitMarketPrice: toMoneyString(line.unitMarketPrice),
      appliedPercentage: line.appliedPercentage.toFixed(2),
      appliedRuleId: line.appliedRuleId,
      hotBuyBonus: line.hotBuyBonus.toFixed(2),
      unitCredit: toMoneyString(line.unitCredit),
    }));
    // Graded slabs: stored with zeroed pricing + graded flag; the admin sets a
    // custom offer via the counter flow.
    const gradedRows = quote.manualLines.map((line) => ({
      submissionId: submission.id,
      productId: line.productId,
      productName: line.productName,
      printing: line.printing,
      condition: null,
      conditionMultiplier: "1",
      quantity: line.quantity,
      unitMarketPrice: "0",
      appliedPercentage: "0",
      appliedRuleId: null,
      hotBuyBonus: "0",
      unitCredit: "0",
      graded: true,
      grader: line.grader,
      grade: line.grade,
    }));
    const allRows = [...rawRows, ...gradedRows];
    if (allRows.length > 0) {
      await tx.insert(tables.submissionTradeInItems).values(allRows);
    }

    if (tradeForLines.length > 0) {
      await tx.insert(tables.submissionTradeForItems).values(
        tradeForLines.map((line) => ({
          submissionId: submission.id,
          inventoryItemId: line.inventoryItemId,
          itemTitle: line.itemTitle,
          quantity: line.quantity,
          unitPrice: toMoneyString(line.unitPrice),
        })),
      );
    }

    if (photos.length > 0) {
      await tx.insert(tables.submissionPhotos).values(
        photos.map((photo) => ({
          submissionId: submission.id,
          contentType: photo.contentType,
          data: photo.data,
        })),
      );
    }
    return submission.id;
  });

  const itemSummary = [
    "They are trading in:",
    ...quote.lines.map(
      (l) =>
        `  ${l.quantity}× ${l.productName}${l.printing ? ` [${l.printing}]` : ""}${l.condition ? ` (${l.condition})` : ""} — $${l.unitCredit.toFixed(2)} each${l.hotBuyBonus > 0 ? ` [HOT BUY +${l.hotBuyBonus}%]` : ""}`,
    ),
    ...(quote.manualLines.length > 0
      ? [
          "Graded — NEEDS CUSTOM OFFER:",
          ...quote.manualLines.map(
            (l) =>
              `  ${l.quantity}× ${l.productName}${l.printing ? ` [${l.printing}]` : ""} — ${l.grader ?? "?"} ${l.grade ?? "?"}${l.refMarketPrice !== null ? ` (raw mkt ~$${l.refMarketPrice.toFixed(2)})` : ""}`,
          ),
        ]
      : []),
    ...(tradeForLines.length > 0
      ? [
          "They want:",
          ...tradeForLines.map(
            (l) =>
              `  ${l.quantity}× ${l.itemTitle} — $${l.unitPrice.toFixed(2)} each`,
          ),
        ]
      : []),
    ...(takeCashRemainder && remainderCashValue !== null
      ? [
          `They want CASH for the leftover credit: $${remainderCashValue.toFixed(2)} (leftover $${leftover.toFixed(2)} at cash rate)`,
        ]
      : []),
  ].join("\n");

  await sendOwnerNewSubmission({
    notifyEmails: settings.notify_emails,
    shopName: settings.shop_name,
    customerName: data.customerName,
    submissionId,
    tradeInTotal: quote.total,
    tradeForTotal,
    itemSummary,
  });

  return NextResponse.json({ token: publicToken });
}
