import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";
import { importCustomerList } from "@/lib/trade-import";

const importSchema = z.object({
  text: z.string().min(1).max(1_000_000),
});

/** Customer list import: parse + match + floor-split into cart items and a bulk lot. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const shopId = await getCurrentShopId();
    const settings = await getSettings(shopId);
    const result = await importCustomerList(parsed.data.text, settings);
    return NextResponse.json(result);
  } catch (err) {
    console.error("List import failed:", err);
    return NextResponse.json(
      { error: "Could not read that list — check the format and try again." },
      { status: 400 },
    );
  }
}
