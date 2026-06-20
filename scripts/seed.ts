/**
 * Seed admin users, default pricing rules, and settings.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Admin credentials are taken from env (see .env.example):
 *   ADMIN1_EMAIL / ADMIN1_NAME / ADMIN1_PASSWORD
 *   ADMIN2_EMAIL / ADMIN2_NAME / ADMIN2_PASSWORD (optional)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, tables } from "../src/db";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { PILOT_SHOP_ID } from "../src/lib/tenant";

/** Ensure the single pilot shop row exists (all Phase-0 data scopes to it). */
async function seedShop() {
  await db
    .insert(tables.shops)
    .values({
      id: PILOT_SHOP_ID,
      platform: "standalone",
      name: DEFAULT_SETTINGS.shop_name,
    })
    .onConflictDoNothing();
  console.log("Seeded pilot shop");
}

async function seedAdmin(n: number) {
  const email = process.env[`ADMIN${n}_EMAIL`];
  const name = process.env[`ADMIN${n}_NAME`];
  const password = process.env[`ADMIN${n}_PASSWORD`];
  if (!email || !password) {
    if (n === 1) {
      throw new Error("ADMIN1_EMAIL and ADMIN1_PASSWORD must be set to seed");
    }
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .insert(tables.adminUsers)
    .values({ email, name: name ?? email, passwordHash })
    .onConflictDoUpdate({
      target: tables.adminUsers.email,
      set: { passwordHash, name: name ?? email },
    });
  console.log(`Seeded admin: ${email}`);
}

async function seedDefaultRules() {
  // Category defaults for store credit. Sealed trades typically run higher
  // than singles; tune these in the admin UI.
  const defaults: {
    category: "singles" | "sealed" | "graded";
    rateType: "store_credit" | "cash";
    percentage: string;
  }[] = [
    { category: "sealed", rateType: "store_credit", percentage: "80.00" },
    { category: "sealed", rateType: "cash", percentage: "70.00" },
    { category: "singles", rateType: "store_credit", percentage: "65.00" },
    { category: "singles", rateType: "cash", percentage: "55.00" },
    { category: "graded", rateType: "store_credit", percentage: "75.00" },
    { category: "graded", rateType: "cash", percentage: "60.00" },
  ];
  for (const d of defaults) {
    await db
      .insert(tables.pricingRules)
      .values({
        shopId: PILOT_SHOP_ID,
        scope: "category",
        category: d.category,
        rateType: d.rateType,
        percentage: d.percentage,
        notes: "Seeded default",
      })
      .onConflictDoNothing();
  }
  console.log("Seeded default category pricing rules");
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .insert(tables.shopSettings)
      .values({ shopId: PILOT_SHOP_ID, key, value })
      .onConflictDoNothing();
  }
  console.log("Seeded default settings");
}

async function main() {
  await seedShop();
  await seedAdmin(1);
  await seedAdmin(2);
  await seedDefaultRules();
  await seedSettings();
  console.log("Seed complete");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
