CREATE TABLE "booking_call_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"leader" text NOT NULL,
	"amount_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_call_week_leader_uq" ON "booking_call_entries" USING btree ("week_start","leader");--> statement-breakpoint
CREATE INDEX "booking_call_week_start_idx" ON "booking_call_entries" USING btree ("week_start");