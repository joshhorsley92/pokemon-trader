CREATE TABLE "buylist_prices" (
	"vendor" text NOT NULL,
	"vendor_key" text NOT NULL,
	"product_id" integer,
	"listing_title" text NOT NULL,
	"set_name" text,
	"card_number" text,
	"printing" text,
	"cash_price" numeric(10, 2),
	"credit_price" numeric(10, 2),
	"condition_prices" jsonb,
	"buying" boolean DEFAULT true NOT NULL,
	"vendor_url" text,
	"synced_at" timestamp with time zone,
	CONSTRAINT "buylist_prices_vendor_vendor_key_pk" PRIMARY KEY("vendor","vendor_key")
);
--> statement-breakpoint
CREATE TABLE "buylist_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"listings_seen" integer DEFAULT 0 NOT NULL,
	"listings_matched" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "buylist_prices" ADD CONSTRAINT "buylist_prices_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_buylist_product" ON "buylist_prices" USING btree ("product_id");