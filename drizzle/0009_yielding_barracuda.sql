CREATE TYPE "public"."show_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."show_txn_kind" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "show_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "show_session_status" DEFAULT 'open' NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now(),
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "show_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" "show_txn_kind" NOT NULL,
	"product_id" integer,
	"title" text NOT NULL,
	"category" "product_category" NOT NULL,
	"condition" text,
	"printing" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"rate_type" "rate_type",
	"unit_price" numeric(10, 2) NOT NULL,
	"line_total" numeric(10, 2) NOT NULL,
	"manual_price" boolean DEFAULT false NOT NULL,
	"inventory_action" text,
	"inventory_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "show_sessions" ADD CONSTRAINT "show_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_sessions" ADD CONSTRAINT "show_sessions_opened_by_admin_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transactions" ADD CONSTRAINT "show_transactions_session_id_show_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."show_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transactions" ADD CONSTRAINT "show_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transactions" ADD CONSTRAINT "show_transactions_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_transactions" ADD CONSTRAINT "show_transactions_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_show_sessions_shop" ON "show_sessions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "idx_show_txn_session" ON "show_transactions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_show_txn_shop" ON "show_transactions" USING btree ("shop_id");