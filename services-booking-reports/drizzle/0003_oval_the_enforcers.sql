CREATE TABLE "booking_call_roster" (
	"id" text PRIMARY KEY NOT NULL,
	"leader" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" numeric(8, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_call_roster_leader_uq" ON "booking_call_roster" USING btree ("leader");--> statement-breakpoint
CREATE INDEX "booking_call_roster_active_sort_idx" ON "booking_call_roster" USING btree ("is_active","sort_order");