CREATE TABLE "card_condition_prices" (
	"product_id" integer NOT NULL,
	"condition" text NOT NULL,
	"printing" text NOT NULL,
	"price" numeric(10, 2),
	"sku_id" text,
	"source" text DEFAULT 'justtcg' NOT NULL,
	"priced_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "card_condition_prices_product_id_condition_printing_pk" PRIMARY KEY("product_id","condition","printing")
);
--> statement-breakpoint
ALTER TABLE "card_condition_prices" ADD CONSTRAINT "card_condition_prices_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cond_prices_product" ON "card_condition_prices" USING btree ("product_id");