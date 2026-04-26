import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { requireRole } from "@/lib/rbac";
import { ingestSnapshotFile } from "@/lib/snapshot-ingestion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const guard = requireRole(request, "admin");
    if (!guard.ok) return guard.response;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const snapshotDateRaw = String(form.get("snapshotDate") ?? "").trim();
    const snapshotDate = snapshotDateRaw ? new Date(snapshotDateRaw) : new Date();
    if (Number.isNaN(snapshotDate.getTime())) {
      return NextResponse.json({ error: "Invalid snapshot date." }, { status: 400 });
    }
    const content = Buffer.from(await file.arrayBuffer());
    const result = await ingestSnapshotFile(file.name, content, snapshotDate);
    revalidateTag("dashboard-snapshots", "max");
    revalidatePath("/");
    revalidatePath("/line-by-line");
    revalidatePath("/booking-call");

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      snapshotId: result.snapshotId,
      snapshotDate: result.snapshotDate,
      kind: result.kind,
      rowsIngested: result.rowsIngested,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
