import { Activity, Clock3, Users } from "lucide-react";

import { formatHours, formatPercent } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type DashboardMetricsProps = {
  overallUtilizationPct: number;
  totalHoursPosted: number;
  totalHeadcount: number;
};

export function DashboardMetrics({
  overallUtilizationPct,
  totalHoursPosted,
  totalHeadcount,
}: DashboardMetricsProps) {
  const cards = [
    {
      title: "Overall Utilization",
      value: formatPercent(overallUtilizationPct),
      icon: Activity,
    },
    {
      title: "Total Hours Posted",
      value: formatHours(totalHoursPosted),
      icon: Clock3,
    },
    {
      title: "Total Headcount",
      value: totalHeadcount.toString(),
      icon: Users,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
