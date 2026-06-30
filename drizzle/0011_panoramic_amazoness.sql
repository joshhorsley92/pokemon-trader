ALTER TABLE "show_pending_items" ADD COLUMN "graded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "show_pending_items" ADD COLUMN "grader" text;--> statement-breakpoint
ALTER TABLE "show_pending_items" ADD COLUMN "grade" text;