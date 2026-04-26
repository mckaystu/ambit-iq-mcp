"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Lock,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/services-signals/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/services-signals/components/ui/table";

type HeatmapCell = {
  region: string;
  wave1: number;
  wave2: number;
  wave3: number;
  wave4: number;
};

type TreeNode = {
  id: string;
  name: string;
  type: "folder" | "site";
  children?: TreeNode[];
};

const NAV_ITEMS = ["Dashboard", "Batch Migrations", "Self-Service", "Governance"] as const;

const heatmapData: HeatmapCell[] = [
  { region: "North America", wave1: 95, wave2: 88, wave3: 74, wave4: 63 },
  { region: "Europe", wave1: 92, wave2: 82, wave3: 78, wave4: 67 },
  { region: "APAC", wave1: 86, wave2: 79, wave3: 69, wave4: 58 },
  { region: "LATAM", wave1: 83, wave2: 77, wave3: 65, wave4: 52 },
  { region: "MEA", wave1: 80, wave2: 71, wave3: 61, wave4: 48 },
];

const migrationTrend = [
  { week: "Wk 1", completed: 5.2 },
  { week: "Wk 2", completed: 7.6 },
  { week: "Wk 3", completed: 10.1 },
  { week: "Wk 4", completed: 12.4 },
  { week: "Wk 5", completed: 14.2 },
  { week: "Wk 6", completed: 15.9 },
];

const activeAgents = [
  {
    name: "PathNormalizer-Agent",
    task: "Resolving SharePoint Long Paths",
    progress: 78,
    status: "Executing",
  },
  {
    name: "IdentityMapper-Agent",
    task: "Mapping AD Identities",
    progress: 61,
    status: "Validating",
  },
  {
    name: "PermissionAudit-Agent",
    task: "Detecting ACL Drift",
    progress: 43,
    status: "Scanning",
  },
  {
    name: "DeltaSync-Agent",
    task: "Applying Incremental Sync",
    progress: 84,
    status: "Finalizing",
  },
];

const batchRows = [
  { id: "BM-1204", source: "FIN-Archive", target: "M365/Finance", files: "2.4M", success: "99.2%" },
  { id: "BM-1205", source: "Legal-CaseShare", target: "M365/Legal", files: "1.1M", success: "98.7%" },
  { id: "BM-1206", source: "HR-EmployeeDocs", target: "M365/HR", files: "820K", success: "99.6%" },
  { id: "BM-1207", source: "Ops-PlantRecords", target: "M365/Ops", files: "3.6M", success: "97.8%" },
];

const governanceRows = [
  { policy: "Encryption at Rest", scope: "All migration waves", status: "Compliant" },
  { policy: "Data Residency Lock", scope: "EU + MEA sites", status: "Compliant" },
  { policy: "PII Auto-Classification", scope: "Self-service imports", status: "Action Required" },
  { policy: "Immutable Audit Trails", scope: "Admin actions", status: "Compliant" },
];

const treeData: TreeNode[] = [
  {
    id: "site-1",
    name: "HCL Global Intranet",
    type: "site",
    children: [
      {
        id: "folder-1",
        name: "Corporate",
        type: "folder",
        children: [
          { id: "folder-1a", name: "Board Reports", type: "folder" },
          { id: "folder-1b", name: "Strategy FY27", type: "folder" },
        ],
      },
      {
        id: "folder-2",
        name: "Engineering",
        type: "folder",
        children: [
          { id: "folder-2a", name: "Platform Docs", type: "folder" },
          { id: "folder-2b", name: "Release Trains", type: "folder" },
        ],
      },
    ],
  },
  {
    id: "site-2",
    name: "Regional SharePoint",
    type: "site",
    children: [
      { id: "folder-3", name: "Americas Programs", type: "folder" },
      { id: "folder-4", name: "EMEA Operations", type: "folder" },
    ],
  },
];

function heatColor(score: number): string {
  if (score >= 90) return "bg-[#004a99]";
  if (score >= 80) return "bg-[#005dbf]";
  if (score >= 70) return "bg-[#0072e8]";
  if (score >= 60) return "bg-[#0084ff]";
  return "bg-[#87c5ff]";
}

function TreeItem({
  node,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = !!node.children?.length;
  const isOpen = expanded.has(node.id);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-100 hover:bg-[#0f2446]"
      >
        {hasChildren ? (
          isOpen ? <ChevronDown className="h-4 w-4 text-[#0084ff]" /> : <ChevronRight className="h-4 w-4 text-[#0084ff]" />
        ) : (
          <span className="inline-block h-4 w-4" />
        )}
        {node.type === "site" ? (
          <Shield className="h-4 w-4 text-[#87c5ff]" />
        ) : isOpen ? (
          <FolderOpen className="h-4 w-4 text-[#87c5ff]" />
        ) : (
          <Folder className="h-4 w-4 text-[#87c5ff]" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {hasChildren && isOpen ? (
        <div className="ml-6 border-l border-[#1f467d] pl-2">
          {node.children?.map((child) => (
            <TreeItem key={child.id} node={child} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FileMigratorDashboard() {
  const [selectedNav, setSelectedNav] = useState<(typeof NAV_ITEMS)[number]>("Dashboard");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["site-1", "folder-1"]));

  const totalMigratedTb = 15.9;
  const totalObjects = 9_800_000;
  const policyCoverage = 97.4;

  const waveTotals = useMemo(
    () => heatmapData.map((row) => (row.wave1 + row.wave2 + row.wave3 + row.wave4) / 4),
    []
  );

  return (
    <div
      className="min-h-screen bg-[#031228] text-slate-100"
      style={{ fontFamily: "Inter, 'Segoe UI', ui-sans-serif, system-ui, sans-serif" }}
    >
      <header className="border-b border-[#1a3f71] bg-gradient-to-r from-[#003b80] via-[#004a99] to-[#0060c9]">
        <div className="mx-auto flex w-full max-w-[1700px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-white/20 bg-white/10 p-2">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-blue-100/90">HCL FileMigrator</p>
              <h1 className="text-xl font-semibold">Sovereign Migration Tool</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-blue-100">
            <Lock className="h-3.5 w-3.5" />
            Sovereign Controls Enabled
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1700px] gap-5 px-6 py-5 lg:grid-cols-[1fr_340px]">
        <section className="space-y-5">
          <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1b3f71] bg-[#081c39] p-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSelectedNav(item)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  selectedNav === item
                    ? "bg-[#0084ff] font-semibold text-white"
                    : "bg-[#0a2244] text-blue-100 hover:bg-[#11315f]"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
              <p className="text-xs uppercase tracking-wide text-blue-200">Global Progress</p>
              <p className="mt-2 text-3xl font-semibold">{totalMigratedTb.toFixed(1)} TB</p>
              <p className="text-xs text-slate-400">Migrated across sovereign zones</p>
            </div>
            <div className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
              <p className="text-xs uppercase tracking-wide text-blue-200">Objects Migrated</p>
              <p className="mt-2 text-3xl font-semibold">{totalObjects.toLocaleString()}</p>
              <p className="text-xs text-slate-400">Files, lists, permissions, metadata</p>
            </div>
            <div className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
              <p className="text-xs uppercase tracking-wide text-blue-200">Policy Coverage</p>
              <p className="mt-2 text-3xl font-semibold">{policyCoverage.toFixed(1)}%</p>
              <p className="text-xs text-slate-400">Governance and encryption policies</p>
            </div>
          </div>

          <Tabs value={selectedNav} onValueChange={(value) => setSelectedNav(value as (typeof NAV_ITEMS)[number])}>
            <TabsList className="h-auto bg-[#0a1f3f] p-1">
              {NAV_ITEMS.map((item) => (
                <TabsTrigger
                  key={item}
                  value={item}
                  className="data-[state=active]:bg-[#0084ff] data-[state=active]:text-white"
                >
                  {item}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="Dashboard" className="mt-4 space-y-4">
              <section className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Migration Health Heatmap</h2>
                  <span className="text-xs text-slate-400">HCL Blue Severity Scale</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-[#1d3e6d]">
                  <Table>
                    <TableHeader className="bg-[#072047]">
                      <TableRow className="border-[#1b3f71] hover:bg-[#072047]">
                        <TableHead className="text-slate-200">Region</TableHead>
                        <TableHead className="text-slate-200">Wave 1</TableHead>
                        <TableHead className="text-slate-200">Wave 2</TableHead>
                        <TableHead className="text-slate-200">Wave 3</TableHead>
                        <TableHead className="text-slate-200">Wave 4</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {heatmapData.map((row) => (
                        <TableRow key={row.region} className="border-[#1b3f71] hover:bg-[#0d2a52]">
                          <TableCell className="font-medium">{row.region}</TableCell>
                          {[row.wave1, row.wave2, row.wave3, row.wave4].map((score, idx) => (
                            <TableCell key={`${row.region}-${idx}`}>
                              <span className={`inline-flex min-w-14 justify-center rounded px-2 py-1 text-xs font-semibold ${heatColor(score)}`}>
                                {score}%
                              </span>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
                <h2 className="mb-3 text-sm font-semibold">Global Progress Trend</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={migrationTrend} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                      <CartesianGrid stroke="#1d3f6f" strokeDasharray="3 3" />
                      <XAxis dataKey="week" stroke="#87c5ff" tick={{ fill: "#dbeafe", fontSize: 12 }} />
                      <YAxis
                        stroke="#87c5ff"
                        tick={{ fill: "#dbeafe", fontSize: 12 }}
                        label={{ value: "TB migrated", angle: -90, position: "insideLeft", fill: "#dbeafe" }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(0,132,255,0.15)" }}
                        contentStyle={{
                          background: "#082449",
                          border: "1px solid #1f467d",
                          color: "#e2e8f0",
                        }}
                      />
                      <Bar dataKey="completed" fill="#0084ff" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="Batch Migrations" className="mt-4">
              <section className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
                <h2 className="mb-3 text-sm font-semibold">Batch Migration Queue</h2>
                <Table>
                  <TableHeader className="bg-[#072047]">
                    <TableRow className="border-[#1b3f71] hover:bg-[#072047]">
                      <TableHead className="text-slate-200">Job ID</TableHead>
                      <TableHead className="text-slate-200">Source</TableHead>
                      <TableHead className="text-slate-200">Target</TableHead>
                      <TableHead className="text-slate-200 text-right">Files</TableHead>
                      <TableHead className="text-slate-200 text-right">Success</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchRows.map((row) => (
                      <TableRow key={row.id} className="border-[#1b3f71] hover:bg-[#0d2a52]">
                        <TableCell className="font-medium">{row.id}</TableCell>
                        <TableCell>{row.source}</TableCell>
                        <TableCell>{row.target}</TableCell>
                        <TableCell className="text-right">{row.files}</TableCell>
                        <TableCell className="text-right text-emerald-300">{row.success}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </TabsContent>

            <TabsContent value="Self-Service" className="mt-4">
              <section className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">SharePoint Source Selector</h2>
                  <span className="text-xs text-slate-400">Select folders for migration wave packaging</span>
                </div>
                <div className="rounded-lg border border-[#1b3f71] bg-[#05162f] p-3">
                  {treeData.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      expanded={expanded}
                      onToggle={(id) =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="Governance" className="mt-4">
              <section className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
                <h2 className="mb-3 text-sm font-semibold">Governance Control Matrix</h2>
                <Table>
                  <TableHeader className="bg-[#072047]">
                    <TableRow className="border-[#1b3f71] hover:bg-[#072047]">
                      <TableHead className="text-slate-200">Policy</TableHead>
                      <TableHead className="text-slate-200">Scope</TableHead>
                      <TableHead className="text-slate-200">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {governanceRows.map((row) => (
                      <TableRow key={row.policy} className="border-[#1b3f71] hover:bg-[#0d2a52]">
                        <TableCell>{row.policy}</TableCell>
                        <TableCell>{row.scope}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                              row.status === "Compliant"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-amber-400/20 text-amber-200"
                            }`}
                          >
                            {row.status === "Compliant" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                            {row.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </TabsContent>
          </Tabs>
        </section>

        <aside className="rounded-xl border border-[#1c416f] bg-[#0a1f3f] p-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-[#0084ff]" />
            Active Agents
          </h2>
          <p className="mb-4 text-xs text-slate-400">Live agentic workload across migration operations</p>
          <div className="space-y-3">
            {activeAgents.map((agent) => (
              <div key={agent.name} className="rounded-lg border border-[#1e4375] bg-[#071b37] p-3">
                <p className="text-xs font-semibold text-blue-100">{agent.name}</p>
                <p className="mt-1 text-sm">{agent.task}</p>
                <p className="mt-1 text-xs text-slate-400">{agent.status}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#10305c]">
                  <div className="h-full rounded-full bg-[#0084ff]" style={{ width: `${agent.progress}%` }} />
                </div>
                <p className="mt-1 text-right text-xs text-blue-200">{agent.progress}%</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-[#1e4375] bg-[#071b37] p-3 text-xs text-slate-300">
            <p className="mb-1 flex items-center gap-2 font-semibold text-blue-100">
              <Lock className="h-3.5 w-3.5" />
              Sovereign Security Signal
            </p>
            <p>Cross-tenant content isolation and encryption escrow checks are passing in all regions.</p>
          </div>

          <div className="mt-4 rounded-lg border border-[#1e4375] bg-[#071b37] p-3 text-xs text-slate-300">
            <p className="mb-2 font-semibold text-blue-100">Regional Wave Health</p>
            <div className="space-y-1.5">
              {["NA", "EU", "APAC", "LATAM", "MEA"].map((region, idx) => (
                <div key={region} className="flex items-center justify-between">
                  <span>{region}</span>
                  <span className="font-medium text-[#87c5ff]">{waveTotals[idx]?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
