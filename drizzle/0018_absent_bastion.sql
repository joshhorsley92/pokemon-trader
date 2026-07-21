ALTER TABLE "catalog_groups" ADD COLUMN "category_id" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_groups_category" ON "catalog_groups" USING btree ("category_id");