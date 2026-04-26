import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { bookingCallEntries, bookingCallRoster } from "@/db/schema";
import { BOOKING_CALL_SERVICE_LEADERS } from "@/lib/booking-call-leaders";
import { requireRole } from "@/lib/rbac";

export const runtime = "nodejs";

function mondayKey(date = new Date()): string {
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const day = clone.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  const y = clone.getFullYear();
  const m = String(clone.getMonth() + 1).padStart(2, "0");
  const d = String(clone.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeWeekKey(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  if (value instanceof Date) {
    return mondayKey(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return mondayKey(parsed);
  }
  return null;
}

function parseAmount(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingRosterTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return msg.toLowerCase().includes("booking_call_roster") && msg.toLowerCase().includes("does not exist");
}

async function loadActiveLeadersOrDefault(db: ReturnType<typeof getDb>): Promise<string[]> {
  try {
    const rosterRows = await db
      .select({
        leader: bookingCallRoster.leader,
        isActive: bookingCallRoster.isActive,
        sortOrder: bookingCallRoster.sortOrder,
      })
      .from(bookingCallRoster)
      .orderBy(bookingCallRoster.sortOrder, bookingCallRoster.leader);
    const leaders = rosterRows.filter((r) => r.isActive).map((r) => r.leader);
    return leaders.length ? leaders : [...BOOKING_CALL_SERVICE_LEADERS];
  } catch (error) {
    if (isMissingRosterTableError(error)) return [...BOOKING_CALL_SERVICE_LEADERS];
    throw error;
  }
}

export async function GET() {
  try {
    const db = getDb();
    const effectiveLeaders = await loadActiveLeadersOrDefault(db);
    const rows = await db
      .select({
        weekStart: bookingCallEntries.weekStart,
        leader: bookingCallEntries.leader,
        amountUsd: bookingCallEntries.amountUsd,
      })
      .from(bookingCallEntries)
      .orderBy(desc(bookingCallEntries.weekStart));

    const byWeek: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const week = normalizeWeekKey(row.weekStart) ?? String(row.weekStart);
      byWeek[week] ??= {};
      byWeek[week][row.leader] = parseAmount(row.amountUsd);
    }

    return NextResponse.json({
      currentWeekStart: mondayKey(),
      leaders: effectiveLeaders,
      weeks: byWeek,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load booking call data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type SaveBody = {
  weekStart: string;
  entries: { leader: string; amountUsd: number | string }[];
};

export async function PUT(request: Request) {
  try {
    const guard = requireRole(request, "editor");
    if (!guard.ok) return guard.response;
    const body = (await request.json()) as SaveBody;
    const weekStart = normalizeWeekKey(body.weekStart);
    const currentWeek = mondayKey();
    if (!weekStart || weekStart !== currentWeek) {
      return NextResponse.json(
        { error: `Only current week (${currentWeek}) is editable.` },
        { status: 403 }
      );
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return NextResponse.json({ error: "No booking call entries provided." }, { status: 400 });
    }

    const db = getDb();
    const allowedLeaders = new Set<string>(await loadActiveLeadersOrDefault(db));
    const normalized = body.entries
      .filter((entry) => allowedLeaders.has(entry.leader))
      .map((entry) => ({
        leader: entry.leader,
        amountUsd: parseAmount(entry.amountUsd),
      }));

    if (!normalized.length) {
      return NextResponse.json({ error: "No valid services leader entries found." }, { status: 400 });
    }

    await Promise.all(
      normalized.map((entry) =>
        db
          .insert(bookingCallEntries)
          .values({
            id: crypto.randomUUID(),
            weekStart,
            leader: entry.leader,
            amountUsd: entry.amountUsd.toFixed(2),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [bookingCallEntries.weekStart, bookingCallEntries.leader],
            set: { amountUsd: entry.amountUsd.toFixed(2), updatedAt: new Date() },
          })
      )
    );

    const savedRows = await db
      .select({
        leader: bookingCallEntries.leader,
        amountUsd: bookingCallEntries.amountUsd,
      })
      .from(bookingCallEntries)
      .where(and(eq(bookingCallEntries.weekStart, weekStart), inArray(bookingCallEntries.leader, [...allowedLeaders])));

    const savedMap: Record<string, number> = {};
    for (const row of savedRows) {
      savedMap[row.leader] = parseAmount(row.amountUsd);
    }

    return NextResponse.json({ ok: true, weekStart, saved: savedMap });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save booking call.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type RosterBody = {
  leaders: string[];
};

export async function PATCH(request: Request) {
  try {
    const guard = requireRole(request, "editor");
    if (!guard.ok) return guard.response;
    const body = (await request.json()) as RosterBody;
    const normalized = Array.from(
      new Set(
        (body.leaders ?? [])
          .map((leader) => String(leader ?? "").trim())
          .filter((leader) => leader.length > 0)
      )
    );
    if (!normalized.length) {
      return NextResponse.json({ error: "At least one services lead is required." }, { status: 400 });
    }
    const db = getDb();
    try {
      await db.select({ id: bookingCallRoster.id }).from(bookingCallRoster).limit(1);
    } catch (error) {
      if (isMissingRosterTableError(error)) {
        return NextResponse.json(
          { error: "Roster table missing. Run `npm run db:migrate` to enable add/remove Services Lead." },
          { status: 400 }
        );
      }
      throw error;
    }
    const existing = await db.select({ leader: bookingCallRoster.leader }).from(bookingCallRoster);
    const existingSet = new Set(existing.map((row) => row.leader));
    await Promise.all(
      normalized.map((leader, idx) =>
        db
          .insert(bookingCallRoster)
          .values({
            id: crypto.randomUUID(),
            leader,
            isActive: true,
            sortOrder: String(idx),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [bookingCallRoster.leader],
            set: { isActive: true, sortOrder: String(idx), updatedAt: new Date() },
          })
      )
    );
    const toDeactivate = [...existingSet].filter((leader) => !normalized.includes(leader));
    if (toDeactivate.length) {
      await Promise.all(
        toDeactivate.map((leader) =>
          db
            .update(bookingCallRoster)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(bookingCallRoster.leader, leader))
        )
      );
    }
    return NextResponse.json({ ok: true, leaders: normalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update roster.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
