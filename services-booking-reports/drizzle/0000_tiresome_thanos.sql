CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"opportunity_id" text NOT NULL,
	"customer" text NOT NULL,
	"opp_name" text NOT NULL,
	"revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"category" text NOT NULL,
	"sub_category" text NOT NULL,
	"fiscal_quarter" text,
	"fiscal_year" text,
	"stage" text NOT NULL,
	"geo" text,
	"country" text,
	"est_close_date" date,
	"owner" text
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"resource_id" text NOT NULL,
	"full_name" text NOT NULL,
	"manager" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"practice" text,
	"geo_obs" text,
	"email" text,
	"job_title" text
);
--> statement-breakpoint
CREATE INDEX "bookings_opportunity_id_idx" ON "bookings" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "bookings_snapshot_date_idx" ON "bookings" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_snapshot_opportunity_uq" ON "bookings" USING btree ("snapshot_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "resources_resource_id_idx" ON "resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resources_snapshot_date_idx" ON "resources" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_snapshot_resource_uq" ON "resources" USING btree ("snapshot_id","resource_id");