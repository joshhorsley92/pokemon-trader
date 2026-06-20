ALTER TABLE "submissions" ADD COLUMN "take_cash_remainder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "remainder_cash_value" numeric(10, 2);