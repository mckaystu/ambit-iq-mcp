import Dashboard from "@/components/dashboard";
import { DatasetErrorScreen } from "@/components/dataset-error-screen";
import { loadAndProcessCsvDataset } from "@/lib/dataProcessor";

export const dynamic = "force-dynamic";

export default async function Home() {
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
        breadcrumb="Overview"
        hint="No bookings snapshot found in Postgres yet. Upload a bookings export to initialize."
      />
    );
  }

  return <Dashboard dataset={dataset} view="overview" />;
}
