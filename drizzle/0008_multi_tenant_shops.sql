-- Multi-tenancy: introduce shops + per-shop scoping.
--
-- Hand-edited from the drizzle-kit output to be backfill-safe on a database
-- that already holds the single pilot shop's data: new shop_id columns are
-- added NULLABLE, backfilled to the pilot shop, then set NOT NULL. The pilot
-- shop id is the fixed constant in src/lib/tenant.ts (PILOT_SHOP_ID).

-- 1. New tenancy tables -------------------------------------------------------
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'standalone' NOT NULL,
	"platform_shop_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"data_provider" text DEFAULT 'tcgcsv' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now(),
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_sessions" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"shop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "shop_settings_shop_id_key_pk" PRIMARY KEY("shop_id","key")
);
--> statement-breakpoint
CREATE TABLE "shop_users" (
	"shop_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "shop_users_shop_id_admin_user_id_pk" PRIMARY KEY("shop_id","admin_user_id")
);
--> statement-breakpoint

-- 2. Seed the pilot shop so backfill FK targets exist ------------------------
INSERT INTO "shops" ("id", "platform", "name")
VALUES ('00000000-0000-0000-0000-000000000001', 'standalone', 'Pilot Shop')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. Move existing global settings into the pilot shop's per-shop settings ----
INSERT INTO "shop_settings" ("shop_id", "key", "value")
SELECT '00000000-0000-0000-0000-000000000001', "key", "value" FROM "settings"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Map every existing admin user to the pilot shop as owner.
INSERT INTO "shop_users" ("shop_id", "admin_user_id", "role")
SELECT '00000000-0000-0000-0000-000000000001', "id", 'owner' FROM "admin_users"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. Add shop_id columns NULLABLE → backfill → NOT NULL ----------------------
ALTER TABLE "hot_buys" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
UPDATE "hot_buys" SET "shop_id" = '00000000-0000-0000-0000-000000000001' WHERE "shop_id" IS NULL;--> statement-breakpoint
ALTER TABLE "hot_buys" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "inventory_items" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
UPDATE "inventory_items" SET "shop_id" = '00000000-0000-0000-0000-000000000001' WHERE "shop_id" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "pricing_rules" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
UPDATE "pricing_rules" SET "shop_id" = '00000000-0000-0000-0000-000000000001' WHERE "shop_id" IS NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "submissions" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
UPDATE "submissions" SET "shop_id" = '00000000-0000-0000-0000-000000000001' WHERE "shop_id" IS NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint

-- submission_rate_limits holds only ephemeral counters; clear them so the new
-- shop_id can join the primary key without a backfill.
DELETE FROM "submission_rate_limits";--> statement-breakpoint
ALTER TABLE "submission_rate_limits" DROP CONSTRAINT "submission_rate_limits_ip_window_start_pk";--> statement-breakpoint
ALTER TABLE "submission_rate_limits" ADD COLUMN "shop_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_rate_limits" ADD CONSTRAINT "submission_rate_limits_shop_id_ip_window_start_pk" PRIMARY KEY("shop_id","ip","window_start");--> statement-breakpoint

-- 5. Foreign keys ------------------------------------------------------------
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_users" ADD CONSTRAINT "shop_users_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hot_buys" ADD CONSTRAINT "hot_buys_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_rate_limits" ADD CONSTRAINT "submission_rate_limits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 6. Indexes (rebuild the two uniques to be per-shop) ------------------------
DROP INDEX "uniq_hot_buy_product";--> statement-breakpoint
DROP INDEX "uniq_pricing_rule_target";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_shop_platform_id" ON "shops" USING btree ("platform","platform_shop_id") WHERE "shops"."platform_shop_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_hot_buys_shop" ON "hot_buys" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_shop" ON "inventory_items" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "idx_pricing_rules_shop" ON "pricing_rules" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_shop" ON "submissions" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_hot_buy_product" ON "hot_buys" USING btree ("shop_id","product_id") WHERE "hot_buys"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pricing_rule_target" ON "pricing_rules" USING btree ("shop_id","scope","rate_type","category","group_id","product_id") WHERE "pricing_rules"."active" = true;
