CREATE TABLE "snapshot_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_uploads_kind_snapshot_hash_uq" ON "snapshot_uploads" USING btree ("kind","snapshot_id","file_hash");--> statement-breakpoint
CREATE INDEX "snapshot_uploads_snapshot_date_idx" ON "snapshot_uploads" USING btree ("snapshot_date");