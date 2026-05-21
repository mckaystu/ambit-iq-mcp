import { LoaderCircle } from "lucide-react";

export default function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-5 text-sm dark:border-slate-700">
      <LoaderCircle className="h-4 w-4 animate-spin text-hcl-blue" />
      <span>{message}</span>
    </div>
  );
}
