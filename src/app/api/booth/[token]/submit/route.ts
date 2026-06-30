import { NextResponse } from "next/server";
import { z } from "zod";
import { createPendingTrade, getSessionByToken } from "@/lib/show";

const categoryEnum = z.enum(["singles", "sealed", "graded"]);

const giveSchema = z.object({
  productId: z.number().int().positive(),
  title: z.string().min(1).max(300),
  category: categoryEnum,
  condition: z.string().max(40).nullish().transform((v) => v ?? null),
  printing: z.string().max(60).nullish().transform((v) => v ?? null),
  quantity: z.number().int().min(1).max(99),
  graded: z.boolean().optional().default(false),
  grader: z.string().max(20).nullish().transform((v) => v ?? null),
  grade: z.string().max(20).nullish().transform((v) => v ?? null),
});

const wantSchema = z.object({
  inventoryItemId: z.string().uuid(),
  title: z.string().min(1).max(300),
  category: categoryEnum,
  condition: z.string().max(40).nullish().transform((v) => v ?? null),
  quantity: z.number().int().min(1).max(99),
});

const bodySchema = z.object({
  label: z.string().max(60).optional().default(""),
  rateType: z.enum(["store_credit", "cash"]),
  gives: z.array(giveSchema).max(200),
  wants: z.array(wantSchema).max(50),
});

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/booth/[token]/submit">,
) {
  const { token } = await ctx.params;
  const found = await getSessionByToken(token);
  if (!found || found.session.status !== "open") {
    return NextResponse.json(
      { error: "This booth isn't taking trades right now." },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade" }, { status: 400 });
  }
  const data = parsed.data;
  if (data.gives.length + data.wants.length === 0) {
    return NextResponse.json({ error: "Add at least one card." }, { status: 400 });
  }

  const lines = [
    ...data.gives.map((g) => ({
      side: "give" as const,
      productId: g.productId,
      inventoryItemId: null,
      title: g.title,
      category: g.category,
      condition: g.condition,
      printing: g.printing,
      quantity: g.quantity,
      graded: g.graded,
      grader: g.grader,
      grade: g.grade,
    })),
    ...data.wants.map((w) => ({
      side: "want" as const,
      productId: null,
      inventoryItemId: w.inventoryItemId,
      title: w.title,
      category: w.category,
      condition: w.condition,
      printing: null,
      quantity: w.quantity,
    })),
  ];

  await createPendingTrade({
    shopId: found.shopId,
    sessionId: found.session.id,
    label: data.label.trim() || null,
    rateType: data.rateType,
    lines,
  });

  return NextResponse.json({ ok: true });
}
