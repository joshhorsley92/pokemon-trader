CREATE TYPE "public"."show_pending_side" AS ENUM('give', 'want');--> statement-breakpoint
CREATE TYPE "public"."show_pending_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "show_pending_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pending_id" uuid NOT NULL,
	"side" "show_pending_side" NOT NULL,
	"product_id" integer,
	"inventory_item_id" uuid,
	"title" text NOT NULL,
	"category" "product_category" NOT NULL,
	"condition" text,
	"printing" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "show_pending_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "show_pending_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text,
	"rate_type" "rate_type" DEFAULT 'store_credit' NOT NULL,
	"status" "show_pending_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "show_sessions" ADD COLUMN "join_token" text;--> statement-breakpoint
ALTER TABLE "show_pending_items" ADD CONSTRAINT "show_pending_items_pending_id_show_pending_trades_id_fk" FOREIGN KEY ("pending_id") REFERENCES "public"."show_pending_trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_pending_items" ADD CONSTRAINT "show_pending_items_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_pending_items" ADD CONSTRAINT "show_pending_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_pending_trades" ADD CONSTRAINT "show_pending_trades_session_id_show_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."show_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_pending_trades" ADD CONSTRAINT "show_pending_trades_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_show_pending_items_pending" ON "show_pending_items" USING btree ("pending_id");--> statement-breakpoint
CREATE INDEX "idx_show_pending_session" ON "show_pending_trades" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "show_sessions" ADD CONSTRAINT "show_sessions_join_token_unique" UNIQUE("join_token");