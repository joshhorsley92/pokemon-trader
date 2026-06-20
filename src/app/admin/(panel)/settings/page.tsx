import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings(await getCurrentShopId());
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-500">
          Shop-wide knobs. Pricing percentages live under Pricing.
        </p>
      </div>
      <SettingsForm
        defaults={{
          shop_name: settings.shop_name,
          quote_validity_days: settings.quote_validity_days,
          notify_emails: settings.notify_emails.join(", "),
          rounding_step: settings.rounding_step,
          fallback_percentage: settings.fallback_percentage,
          min_item_price: settings.min_item_price,
          min_single_price: settings.min_single_price,
          inventory_market_markup: settings.inventory_market_markup,
        }}
        conditionMultipliers={settings.condition_multipliers}
        analyzerEconomics={settings.analyzer_economics}
      />
    </div>
  );
}
