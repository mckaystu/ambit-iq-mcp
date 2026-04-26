"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

type UtilizationUploadProps = {
  kind: "timesheet" | "resource";
};

export default function UtilizationUpload({ kind }: UtilizationUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
      form.append("kind", kind);
      const response = await fetch("/api/upload-utilization", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as { error?: string; savedAs?: string };
      if (!response.ok) {
        throw new Error(body.error || "Upload failed.");
      }
      setMessage(`Uploaded as ${body.savedAs ?? file.name}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const label = kind === "timesheet" ? "Upload Utilization File" : "Upload Resource File";

  return (
    <div className="flex flex-col items-end gap-1">
      <label
        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm transition hover:bg-slate-50"
        htmlFor={`util-upload-${kind}`}
      >
        <Upload className="h-3.5 w-3.5" />
        {uploading ? "Uploading..." : label}
      </label>
      <input
        id={`util-upload-${kind}`}
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={onSelect}
        disabled={uploading}
      />
      {message ? <p className="text-[11px] text-emerald-700">{message}</p> : null}
      {error ? <p className="text-[11px] text-rose-700">{error}</p> : null}
    </div>
  );
}
