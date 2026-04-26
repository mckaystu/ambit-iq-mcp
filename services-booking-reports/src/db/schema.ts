import { boolean, date, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull(),
    snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull(),
    opportunityId: text("opportunity_id").notNull(),
    customer: text("customer").notNull(),
    oppName: text("opp_name").notNull(),
    revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
    category: text("category").notNull(),
    subCategory: text("sub_category").notNull(),
    fiscalQuarter: text("fiscal_quarter"),
    fiscalYear: text("fiscal_year"),
    stage: text("stage").notNull(),
    geo: text("geo"),
    country: text("country"),
    estCloseDate: date("est_close_date"),
    owner: text("owner"),
  },
  (table) => [
    index("bookings_opportunity_id_idx").on(table.opportunityId),
    index("bookings_snapshot_date_idx").on(table.snapshotDate),
    uniqueIndex("bookings_snapshot_opportunity_uq").on(table.snapshotId, table.opportunityId),
  ]
);

export const resources = pgTable(
  "resources",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull(),
    snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull(),
    resourceId: text("resource_id").notNull(),
    fullName: text("full_name").notNull(),
    manager: text("manager"),
    isActive: boolean("is_active").notNull().default(true),
    practice: text("practice"),
    geoObs: text("geo_obs"),
    email: text("email"),
    jobTitle: text("job_title"),
  },
  (table) => [
    index("resources_resource_id_idx").on(table.resourceId),
    index("resources_snapshot_date_idx").on(table.snapshotDate),
    uniqueIndex("resources_snapshot_resource_uq").on(table.snapshotId, table.resourceId),
  ]
);

export const snapshotUploads = pgTable(
  "snapshot_uploads",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("snapshot_uploads_kind_snapshot_hash_uq").on(
      table.kind,
      table.snapshotId,
      table.fileHash
    ),
    index("snapshot_uploads_snapshot_date_idx").on(table.snapshotDate),
  ]
);

export const bookingCallEntries = pgTable(
  "booking_call_entries",
  {
    id: text("id").primaryKey(),
    weekStart: date("week_start").notNull(),
    leader: text("leader").notNull(),
    amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("booking_call_week_leader_uq").on(table.weekStart, table.leader),
    index("booking_call_week_start_idx").on(table.weekStart),
  ]
);

export const bookingCallRoster = pgTable(
  "booking_call_roster",
  {
    id: text("id").primaryKey(),
    leader: text("leader").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: numeric("sort_order", { precision: 8, scale: 0 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("booking_call_roster_leader_uq").on(table.leader),
    index("booking_call_roster_active_sort_idx").on(table.isActive, table.sortOrder),
  ]
);
