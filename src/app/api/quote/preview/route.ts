import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { quoteFromDb } from "@/lib/quote";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const previewSchema = z.object({
  rateType: z.enum(["store_credit", "cash"]),
  items: z
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
    .max(50),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const shopId = await getCurrentShopId();
    const settings = await getSettings(shopId);
    const otherRate =
      parsed.data.rateType === "store_credit" ? "cash" : "store_credit";
    const [quote, otherQuote] = await Promise.all([
      quoteFromDb(parsed.data.items, parsed.data.rateType, settings, shopId),
      quoteFromDb(parsed.data.items, otherRate, settings, shopId),
    ]);
    return NextResponse.json({
      ...quote,
      // Both totals so the client can show the cash value of leftover credit
      totals: {
        [parsed.data.rateType]: quote.total,
        [otherRate]: otherQuote.total,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Quote failed" },
      { status: 400 },
    );
  }
}
