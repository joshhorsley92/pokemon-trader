import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { analyzeListText } from "@/lib/analyzer/run";
import { ndjsonAnalysis } from "@/lib/analyzer/stream";
import { getCurrentShopId } from "@/lib/tenant";

const analyzeSchema = z.object({
  // Raw pasted text or CSV file contents; format auto-detected.
  // Real collection exports run >2MB; Vercel caps bodies ~4.5MB, locally
  // this is the only limit.
  list: z.string().max(20_000_000).default(""),
  // Manually added rows from the catalog search
  extra: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(999),
        condition: z.string().max(20).optional(),
      }),
    )
    .max(500)
    .default([]),
});

export async function POST(request: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!parsed.data.list.trim() && parsed.data.extra.length === 0) {
    return NextResponse.json({ error: "Empty list" }, { status: 400 });
  }
  const shopId = await getCurrentShopId();
  return ndjsonAnalysis((progress) =>
    analyzeListText(shopId, parsed.data.list, parsed.data.extra, progress),
  );
}
