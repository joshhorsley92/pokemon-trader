CREATE TYPE "public"."inventory_status" AS ENUM('available', 'reserved', 'sold', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('singles', 'sealed', 'graded');--> statement-breakpoint
CREATE TYPE "public"."rate_type" AS ENUM('store_credit', 'cash');--> statement-breakpoint
CREATE TYPE "public"."rule_scope" AS ENUM('category', 'set', 'product');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'under_review', 'countered', 'accepted', 'declined', 'expired', 'completed');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "catalog_groups" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"published_on" date,
	"modified_on" text,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"clean_name" text,
	"category" "product_category" NOT NULL,
	"category_override" "product_category",
	"image_url" text,
	"tcgplayer_url" text,
	"ext_data" jsonb,
	"market_price" numeric(10, 2),
	"low_price" numeric(10, 2),
	"price_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" integer,
	"title" text NOT NULL,
	"category" "product_category" NOT NULL,
	"condition" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"asking_price" numeric(10, 2),
	"photo_url" text,
	"status" "inventory_status" DEFAULT 'available' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"product_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"market_price" numeric(10, 2),
	CONSTRAINT "price_snapshots_product_id_snapshot_date_pk" PRIMARY KEY("product_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "rule_scope" NOT NULL,
	"rate_type" "rate_type" DEFAULT 'store_credit' NOT NULL,
	"category" "product_category",
	"group_id" integer,
	"product_id" integer,
	"percentage" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_rate_limits" (
	"ip" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "submission_rate_limits_ip_window_start_pk" PRIMARY KEY("ip","window_start")
);
--> statement-breakpoint
CREATE TABLE "submission_trade_for_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"item_title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_trade_in_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_market_price" numeric(10, 2) NOT NULL,
	"applied_percentage" numeric(5, 2) NOT NULL,
	"applied_rule_id" uuid,
	"unit_credit" numeric(10, 2) NOT NULL,
	"counter_unit_credit" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_token" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"rate_type" "rate_type" DEFAULT 'store_credit' NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"trade_in_total" numeric(10, 2) NOT NULL,
	"trade_for_total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"counter_total" numeric(10, 2),
	"quote_expires_at" timestamp with time zone NOT NULL,
	"customer_message" text,
	"admin_notes" text,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "submissions_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"groups_processed" integer DEFAULT 0 NOT NULL,
	"products_upserted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_group_id_catalog_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."catalog_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_group_id_catalog_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."catalog_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_trade_for_items" ADD CONSTRAINT "submission_trade_for_items_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_trade_for_items" ADD CONSTRAINT "submission_trade_for_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD CONSTRAINT "submission_trade_in_items_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD CONSTRAINT "submission_trade_in_items_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD CONSTRAINT "submission_trade_in_items_applied_rule_id_pricing_rules_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewed_by_admin_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_products_group" ON "catalog_products" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_products_cat" ON "catalog_products" USING btree ("category") WHERE "catalog_products"."market_price" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_products_name_search" ON "catalog_products" USING gin (to_tsvector('simple', "name"));--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pricing_rule_target" ON "pricing_rules" USING btree ("scope","rate_type","category","group_id","product_id") WHERE "pricing_rules"."active" = true;