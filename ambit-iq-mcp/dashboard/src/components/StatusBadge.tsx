import { Badge } from "@tremor/react";

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  const value = String(status || "unknown").toLowerCase();
  const color =
    value.includes("high") || value.includes("block") || value.includes("deny") || value.includes("open")
      ? "red"
      : value.includes("medium") || value.includes("warn")
        ? "amber"
        : value.includes("low") || value.includes("allow") || value.includes("closed")
          ? "emerald"
          : "gray";
  return <Badge color={color}>{status || "unknown"}</Badge>;
}
