import Dashboard from "@/components/dashboard";
import { DatasetErrorScreen } from "@/components/dataset-error-screen";
import { loadAndProcessCsvDataset } from "@/lib/dataProcessor";

export const dynamic = "force-dynamic";

export default async function LineByLinePage() {
  let dataset: Awaited<ReturnType<typeof loadAndProcessCsvDataset>> | null = null;
  let message: string | null = null;

  try {
    dataset = await loadAndProcessCsvDataset();
  } catch (error) {
    message = error instanceof Error ? error.message : "Unknown data processing error";
  }

  if (!dataset) {
    return (
      <DatasetErrorScreen
        message={message}
        breadcrumb="Line-by-Line"
        navActive="details"
        hint="Add `data/latest_opportunities.csv` (or any CSV/XLS/XLSX in `/data`) and refresh."
      />
    );
  }

  return <Dashboard dataset={dataset} view="lineByLine" />;
}
