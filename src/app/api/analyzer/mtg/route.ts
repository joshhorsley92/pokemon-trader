import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { analyzeMtgList } from "@/lib/analyzer/mtg/run";
import { ndjsonAnalysis } from "@/lib/analyzer/stream";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const analyzeSchema = z.object({
  // Raw pasted text or ManaBox CSV file contents; format auto-detected.
  // Real collection exports run >2MB (19 columns × 10k+ rows), so the cap is
  // generous. Note: Vercel serverless caps request bodies around 4.5MB —
  // locally this is the only limit.
  list: z.string().max(20_000_000).default(""),
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
  if (!parsed.data.list.trim()) {
    return NextResponse.json({ error: "Empty list" }, { status: 400 });
  }
  const settings = await getSettings(await getCurrentShopId());
  return ndjsonAnalysis((progress) =>
    analyzeMtgList(
      parsed.data.list,
      settings.analyzer_economics,
      settings.condition_multipliers,
      progress,
    ),
  );
}
