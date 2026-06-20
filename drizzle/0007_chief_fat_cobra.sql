ALTER TABLE "catalog_products" ADD COLUMN "printings" jsonb;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD COLUMN "printing" text;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD COLUMN "graded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD COLUMN "grader" text;--> statement-breakpoint
ALTER TABLE "submission_trade_in_items" ADD COLUMN "grade" text;