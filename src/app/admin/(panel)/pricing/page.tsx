import { and, desc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";
import { AddRuleForm, RoundingControl, RuleRow } from "./rule-forms";

export const metadata = { title: "Pricing Rules" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const shopId = await getCurrentShopId();
  const [rules, groups, settings] = await Promise.all([
    db
      .select({
        id: tables.pricingRules.id,
        scope: tables.pricingRules.scope,
        rateType: tables.pricingRules.rateType,
        category: tables.pricingRules.category,
        groupId: tables.pricingRules.groupId,
        groupName: tables.catalogGroups.name,
        productId: tables.pricingRules.productId,
        productName: tables.catalogProducts.name,
        percentage: tables.pricingRules.percentage,
        flatAmount: tables.pricingRules.flatAmount,
        notes: tables.pricingRules.notes,
      })
      .from(tables.pricingRules)
      .leftJoin(
        tables.catalogGroups,
        eq(tables.catalogGroups.id, tables.pricingRules.groupId),
      )
      .leftJoin(
        tables.catalogProducts,
        eq(tables.catalogProducts.id, tables.pricingRules.productId),
      )
      .where(
        and(
          eq(tables.pricingRules.shopId, shopId),
          eq(tables.pricingRules.active, true),
        ),
      )
      .orderBy(
        tables.pricingRules.scope,
        tables.pricingRules.rateType,
        desc(tables.pricingRules.createdAt),
      ),
    db
      .select({ id: tables.catalogGroups.id, name: tables.catalogGroups.name })
      .from(tables.catalogGroups)
      .orderBy(desc(tables.catalogGroups.publishedOn)),
    getSettings(shopId),
  ]);

  const categoryRules = rules.filter((r) => r.scope === "category");
  const setRules = rules.filter((r) => r.scope === "set");
  const productRules = rules.filter((r) => r.scope === "product");

  const payoutLabel = (rateType: string) =>
    rateType === "store_credit" ? "Store credit" : "Cash";
  const toRow = (r: (typeof rules)[number], label: string) => ({
    id: r.id,
    label: `${label} · ${payoutLabel(r.rateType)}`,
    percentage: Number(r.percentage),
    flatAmount: r.flatAmount === null ? null : Number(r.flatAmount),
    notes: r.notes,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing rules</h1>
        <p className="text-sm text-neutral-500">
          Trade-in credit = market price × percentage (or a flat $ for product
          overrides). The most specific rule wins: product → set → category.
          Items with no matching rule fall back to{" "}
          {settings.fallback_percentage}%.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rounding</CardTitle>
          <CardDescription>
            Applies to every quoted trade-in credit and cash-out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoundingControl
            mode={settings.rounding_mode}
            step={settings.rounding_step}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category defaults</CardTitle>
          <CardDescription>
            Baseline percentages for each product type and payout method.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {categoryRules.length === 0 && (
            <p className="text-sm text-neutral-500">
              No category defaults yet — run <code>npm run db:seed</code> or add
              them below.
            </p>
          )}
          {categoryRules.map((r) => (
            <RuleRow key={r.id} rule={toRow(r, r.category ?? "?")} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Set overrides</CardTitle>
          <CardDescription>
            Override the category default for every product in a set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {setRules.map((r) => (
            <RuleRow key={r.id} rule={toRow(r, String(r.groupName ?? r.groupId))} />
          ))}
          {setRules.length === 0 && (
            <p className="text-sm text-neutral-500">No set overrides.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product overrides</CardTitle>
          <CardDescription>
            Pin a percentage — or a flat dollar amount — for one specific
            product.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {productRules.map((r) => (
            <RuleRow
              key={r.id}
              rule={toRow(r, String(r.productName ?? r.productId))}
            />
          ))}
          {productRules.length === 0 && (
            <p className="text-sm text-neutral-500">No product overrides.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add rule</CardTitle>
          <CardDescription>
            Set store credit and cash together; leave one blank to skip it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddRuleForm groups={groups} />
        </CardContent>
      </Card>
    </div>
  );
}
