import { NextResponse } from "next/server";
import { getSession as getAdminSession } from "@/lib/auth";
import {
  getSession,
  listTransactions,
  sessionCsv,
} from "@/lib/show";
import { getCurrentShopId } from "@/lib/tenant";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/admin/show/[id]/export">,
) {
  if (!(await getAdminSession())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  const shopId = await getCurrentShopId();
  const session = await getSession(shopId, id);
  if (!session) return new NextResponse("Not found", { status: 404 });

  const transactions = await listTransactions(shopId, id);
  const csv = sessionCsv(session, transactions);
  const slug = session.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="show-${slug}.csv"`,
    },
  });
}
