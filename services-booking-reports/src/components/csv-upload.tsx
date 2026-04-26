"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

export default function CsvUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("snapshotDate", snapshotDate);
      const response = await fetch("/api/upload-csv", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as {
        error?: string;
        kind?: "bookings" | "resources";
        rowsIngested?: number;
        snapshotId?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Upload failed.");
      }
      setMessage(
        `Ingested ${body.rowsIngested ?? 0} ${body.kind ?? "rows"} for snapshot ${body.snapshotId ?? snapshotDate}.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        type="date"
        value={snapshotDate}
        onChange={(event) => setSnapshotDate(event.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
        disabled={uploading}
      />
      <label
        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
        htmlFor="csv-upload-input"
      >
        <Upload className="h-4 w-4" />
        {uploading ? "Uploading..." : "Upload Weekly Report"}
      </label>
      <input
        id="csv-upload-input"
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={onSelect}
        disabled={uploading}
      />
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
