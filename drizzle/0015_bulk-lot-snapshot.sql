ALTER TABLE "submissions" ADD COLUMN "bulk_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "bulk_rate_per_thousand" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "bulk_total" numeric(10, 2) DEFAULT '0' NOT NULL;