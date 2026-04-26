import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";

export const runtime = "nodejs";

const UTILIZATION_DIR = path.join(process.cwd(), "data", "utilization");
const ALLOWED_EXT = new Set([".csv", ".xlsx", ".xls"]);

const TARGETS: Record<"timesheet" | "resource", string[]> = {
  timesheet: [
    "latest_timesheet.csv",
    "latest_timesheet.xlsx",
    "latest_timesheet.xls",
  ],
  resource: [
    "latest_resource_master.csv",
    "latest_resource_master.xlsx",
    "latest_resource_master.xls",
  ],
};

export async function POST(request: Request) {
  try {
    const guard = requireRole(request, "admin");
    if (!guard.ok) return guard.response;
    const form = await request.formData();
    const file = form.get("file");
    const kindRaw = String(form.get("kind") ?? "").toLowerCase();
    const kind = kindRaw === "timesheet" || kindRaw === "resource" ? kindRaw : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (!kind) {
      return NextResponse.json(
        { error: "Upload kind must be either 'timesheet' or 'resource'." },
        { status: 400 }
      );
    }

    const lower = file.name.toLowerCase();
    const ext = path.extname(lower);
    const isSupported =
      ALLOWED_EXT.has(ext) ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isSupported) {
      return NextResponse.json(
        { error: "Only CSV/XLS/XLSX uploads are supported." },
        { status: 400 }
      );
    }

    await fs.mkdir(UTILIZATION_DIR, { recursive: true });
    await Promise.all(
      TARGETS[kind].map(async (name) => {
        try {
          await fs.unlink(path.join(UTILIZATION_DIR, name));
        } catch {
          // Ignore when file doesn't exist.
        }
      })
    );

    const content = Buffer.from(await file.arrayBuffer());
    const targetName =
      kind === "timesheet"
        ? `latest_timesheet${ext || ".csv"}`
        : `latest_resource_master${ext || ".csv"}`;
    const targetPath = path.join(UTILIZATION_DIR, targetName);
    await fs.writeFile(targetPath, content);

    return NextResponse.json({
      ok: true,
      kind,
      fileName: file.name,
      savedAs: targetName,
      sizeBytes: content.byteLength,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
