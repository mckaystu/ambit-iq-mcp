"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Lock, PhoneCall, Plus, Save, Trash2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { HclSignalsNav } from "@/components/hcl-signals-nav";
import { HCL_CHART_GRID, HCL_CHART_TOOLTIP } from "@/lib/hcl-chart-theme";

type BookingCallTableProps = {
  sourceFile: string;
  leaders: string[];
};

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function HclSoftwareLogo() {
  return (
    <div
      className="inline-flex items-center rounded-md bg-white px-2.5 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.25)] ring-1 ring-black/10"
      role="img"
      aria-label="HCL Software"
    >
      <svg
        width="130"
        height="17"
        viewBox="0 0 174 23"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M13.185 1.21411V9.64467H4.53648V1.21411H0.0649414V22.4462H4.53648V13.5591H13.185V22.4462H17.6565V1.21411H13.185Z" fill="#181B1C" />
        <path d="M46.1954 18.499V1.21411H41.7192V18.5622C41.7192 21.0813 43.0655 22.4462 45.5372 22.4462H55.7069V18.499H46.1954Z" fill="#181B1C" />
        <path d="M20.4634 11.6043C20.4634 4.45902 25.0017 0.764648 30.1774 0.764648C35.0494 0.764648 38.6188 3.79178 39.1458 8.36409H34.8008C34.5247 6.15403 32.6146 4.66972 30.1774 4.66972C27.0499 4.66972 24.6426 7.0624 24.6426 11.6019C24.6426 16.1415 27.0499 18.5037 30.1774 18.5037C32.6675 18.5037 34.5776 17.0194 34.9113 14.8398H39.063C38.7039 19.3817 35.1322 22.4392 30.1774 22.4392C24.9188 22.4392 20.4634 18.7449 20.4634 11.5996V11.6043Z" fill="#181B1C" />
        <path d="M57.2981 14.9309H62.3656C62.4853 16.7196 63.6774 17.8738 65.4656 17.8738C67.0466 17.8738 68.0592 17.1153 68.0592 15.933C68.0592 12.3533 57.832 15.5982 57.832 6.95457C57.832 3.34448 60.8744 0.766846 65.1365 0.766846C69.7875 0.766846 72.8598 3.46622 72.9174 7.6218H67.9073C67.7877 6.2569 66.7751 5.37662 65.1342 5.37662C63.8224 5.37662 62.9571 6.01341 62.9571 6.95457C62.9571 10.9275 73.3638 7.25892 73.3638 15.8417C73.3638 19.8755 70.2639 22.4836 65.4633 22.4836C60.6626 22.4836 57.443 19.5103 57.2935 14.9309H57.2981Z" fill="#181B1C" />
        <path d="M116.381 22.4485H120.585L122.969 14.046L125.296 22.4485H129.501L134.511 7.16064H129.591L127.383 15.4414L125.147 7.16064H120.735L118.528 15.4414L116.291 7.16064H116.293H107.879V0.5H102.959V7.16298H97.3462V4.59939H101.461V0.5H96.0643C93.9172 0.5 92.4259 1.99133 92.4259 4.17564V7.16298H89.0245V9.94897C87.6114 7.95195 85.2594 6.72518 82.4081 6.72518C77.7271 6.72518 74.3579 10.0918 74.3579 14.6126C74.3579 19.1334 77.7271 22.5 82.4081 22.5C87.089 22.5 90.4582 19.1334 90.4582 14.6126C90.4582 13.4186 90.2235 12.3042 89.7908 11.3115L92.4259 11.3162V22.4508H97.3462V11.2881H102.959V18.7494C102.959 21.1164 104.271 22.4508 106.598 22.4508H111.668V18.3257H107.882V11.2881H111.587V7.74359L116.383 22.4485H116.381ZM82.4104 18.2484C80.5325 18.2484 79.2805 16.7922 79.2805 14.6079C79.2805 12.4236 80.5325 10.9674 82.4104 10.9674C84.2883 10.9674 85.5402 12.4236 85.5402 14.6079C85.5402 16.7922 84.2883 18.2484 82.4104 18.2484Z" fill="#181B1C" />
        <path d="M134.261 17.9207C134.261 14.917 136.408 13.0979 139.568 13.0979H141.715C142.49 13.0979 142.907 12.5524 142.907 11.8243C142.907 10.9136 142.161 10.2768 140.819 10.2768C139.179 10.2768 138.583 11.3092 138.553 12.4002H134.258C134.378 9.30517 136.672 6.72754 141.116 6.72754C144.872 6.72754 147.795 8.97272 147.795 12.4306V22.4438H142.905V20.3766C142.518 21.6502 140.997 22.5 139.059 22.5C136.256 22.5 134.258 20.4679 134.258 17.9207H134.261ZM140.433 19.0117C142.014 19.0117 142.907 17.6772 142.907 16.2514V16.1297H140.403C139.538 16.1297 138.912 16.7665 138.912 17.6772C138.912 18.4662 139.568 19.0117 140.433 19.0117Z" fill="#181B1C" />
        <path d="M158.56 11.3115C158.144 12.3814 157.951 13.5285 157.951 14.6102C157.951 18.2203 160.395 22.4976 165.791 22.4976C169.49 22.4976 172.44 20.3437 173.066 16.9467H168.325C168.056 17.9791 167.133 18.4637 165.791 18.4637C164.003 18.4637 162.958 17.4922 162.661 15.7948H173.008C173.038 15.4319 173.068 15.0058 173.068 14.3082C173.068 11.0937 171.19 6.7251 165.494 6.7251C162.705 6.7251 160.784 7.86759 159.578 9.46895V9.32614V7.1629H152.961C150.814 7.1629 149.323 8.67998 149.323 10.8643V22.4508H154.243V11.3091H158.56V11.3115ZM165.492 10.2743C167.191 10.2743 168.116 11.5175 168.205 12.8215H162.659C162.988 10.972 163.911 10.2743 165.492 10.2743Z" fill="#181B1C" />
      </svg>
    </div>
  );
}

function formatMondayKey(d: Date): string {
  const clone = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  const day = clone.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  const y = clone.getFullYear();
  const m = String(clone.getMonth() + 1).padStart(2, "0");
  const dayn = String(clone.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayn}`;
}

function normalizeWeekKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatMondayKey(parsed);
}

function formatWeekLabel(key: string): string {
  const [y, mo, d] = key.split("-").map(Number);
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseCurrencyInput(value: string): number {
  const parsed = Number.parseFloat(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function BookingCallTable({ sourceFile, leaders }: BookingCallTableProps) {
  const [sortedLeaders, setSortedLeaders] = useState<string[]>([...leaders]);
  const initialWeek = useMemo(() => formatMondayKey(new Date()), []);
  const [currentWeekStart, setCurrentWeekStart] = useState(initialWeek);
  const [selectedWeek, setSelectedWeek] = useState(initialWeek);
  const [weeks, setWeeks] = useState<Record<string, Record<string, number>>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLeader, setNewLeader] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/booking-call", { cache: "no-store" });
        const body = (await response.json()) as {
          error?: string;
          currentWeekStart?: string;
          leaders?: string[];
          weeks?: Record<string, Record<string, number>>;
        };
        if (!response.ok) throw new Error(body.error || "Failed to load booking call.");
        const current = body.currentWeekStart ?? initialWeek;
        const leadersFromServer = (body.leaders ?? [...leaders]).filter(Boolean);
        setSortedLeaders(leadersFromServer);
        const rawWeekData = body.weeks ?? {};
        const weekData: Record<string, Record<string, number>> = {};
        for (const [key, entries] of Object.entries(rawWeekData)) {
          weekData[normalizeWeekKey(key)] = entries;
        }
        setCurrentWeekStart(current);
        setSelectedWeek(current);
        setWeeks(weekData);
        const nextDraft: Record<string, string> = {};
        for (const leader of leadersFromServer) nextDraft[leader] = String(weekData[current]?.[leader] ?? "");
        setDraft(nextDraft);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load booking call.");
      } finally {
        setLoading(false);
      }
    })();
  }, [initialWeek, leaders]);

  const availableWeeks = useMemo(() => {
    const keys = new Set<string>(Object.keys(weeks).map((key) => normalizeWeekKey(key)));
    keys.add(currentWeekStart);
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [weeks, currentWeekStart]);

  const editable = selectedWeek === currentWeekStart;
  const previousWeeks = useMemo(() => {
    const history = availableWeeks.filter((week) => week < selectedWeek).sort((a, b) => b.localeCompare(a));
    return history.slice(0, 3);
  }, [availableWeeks, selectedWeek]);

  const selectedTotal = useMemo(
    () => sortedLeaders.reduce((sum, leader) => sum + parseCurrencyInput(draft[leader] ?? ""), 0),
    [draft, sortedLeaders]
  );
  const previousTotals = useMemo(
    () =>
      previousWeeks.map((week) => ({
        week,
        total: sortedLeaders.reduce((sum, leader) => sum + Number(weeks[week]?.[leader] ?? 0), 0),
      })),
    [previousWeeks, sortedLeaders, weeks]
  );

  const onChangeWeek = (weekKey: string) => {
    setSelectedWeek(weekKey);
    const nextDraft: Record<string, string> = {};
    for (const leader of sortedLeaders) nextDraft[leader] = String(weeks[weekKey]?.[leader] ?? "");
    setDraft(nextDraft);
    setMessage(null);
    setError(null);
  };

  const onSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const entries = sortedLeaders.map((leader) => ({
        leader,
        amountUsd: parseCurrencyInput(draft[leader] ?? ""),
      }));
      const response = await fetch("/api/booking-call", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: selectedWeek, entries }),
      });
      const body = (await response.json()) as {
        error?: string;
        weekStart?: string;
        saved?: Record<string, number>;
      };
      if (!response.ok) throw new Error(body.error || "Failed to save booking call.");
      const weekStart = body.weekStart ?? selectedWeek;
      const saved = body.saved ?? {};
      setWeeks((prev) => ({ ...prev, [weekStart]: saved }));
      const nextDraft: Record<string, string> = {};
      for (const leader of sortedLeaders) nextDraft[leader] = String(saved[leader] ?? "");
      setDraft(nextDraft);
      setMessage(`Saved ${formatWeekLabel(weekStart)} booking call values.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const persistRoster = async (nextLeaders: string[]) => {
    const response = await fetch("/api/booking-call", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaders: nextLeaders }),
    });
    const body = (await response.json()) as { error?: string; leaders?: string[] };
    if (!response.ok) throw new Error(body.error || "Failed to update services leads.");
    return body.leaders ?? nextLeaders;
  };

  const onAddLeader = async () => {
    const candidate = newLeader.trim();
    if (!candidate) return;
    if (sortedLeaders.includes(candidate)) {
      setError("That services lead already exists.");
      return;
    }
    try {
      setError(null);
      const next = [...sortedLeaders, candidate];
      const savedLeaders = await persistRoster(next);
      setSortedLeaders(savedLeaders);
      setDraft((prev) => ({ ...prev, [candidate]: prev[candidate] ?? "" }));
      setNewLeader("");
      setMessage("Services lead added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add services lead.");
    }
  };

  const onRemoveLeader = async (leader: string) => {
    if (sortedLeaders.length <= 1) {
      setError("At least one services lead is required.");
      return;
    }
    try {
      setError(null);
      const next = sortedLeaders.filter((item) => item !== leader);
      const savedLeaders = await persistRoster(next);
      setSortedLeaders(savedLeaders);
      setDraft((prev) => {
        const out = { ...prev };
        delete out[leader];
        return out;
      });
      setMessage(`Removed ${leader}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove services lead.");
    }
  };

  const trend = useMemo(() => {
    const asc = [...availableWeeks].sort((a, b) => a.localeCompare(b));
    return asc.map((weekKey) => ({
      week: formatWeekLabel(weekKey),
      total: sortedLeaders.reduce((sum, leader) => sum + Number(weeks[weekKey]?.[leader] ?? 0), 0),
    }));
  }, [availableWeeks, sortedLeaders, weeks]);

  return (
    <div className="hcl-enhanced min-h-screen text-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-gradient-to-r from-[#002952] via-[#003a70] to-[#002952] text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.06]">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <HclSoftwareLogo />
            <div className="rounded bg-white/15 p-2 ring-1 ring-white/25">
              <PhoneCall className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">HCLSoftware</p>
              <h1 className="text-xl font-semibold">Xperience Services Signals Dashboard</h1>
              <p className="text-[11px] text-blue-100/90">Weekly booking call persisted in Postgres</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:gap-3">
            <p className="text-xs text-blue-100">
              Source: <span className="font-semibold">{sourceFile}</span>
            </p>
            <HclSignalsNav active="bookingCall" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="font-medium text-slate-500">Reports</span>
          <span className="mx-1 text-slate-400">/</span>
          <span className="font-semibold text-slate-800">Booking Call</span>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Weekly Booking Call (USD)</h2>
              <p className="text-xs text-slate-500">
                Current week is editable; previous weeks are locked automatically after Monday rollover.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">
                Week:
                <select
                  value={selectedWeek}
                  onChange={(e) => onChangeWeek(e.target.value)}
                  className="ml-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  disabled={loading}
                >
                  {availableWeeks.map((week) => (
                    <option key={week} value={week}>
                      {formatWeekLabel(week)}
                    </option>
                  ))}
                </select>
              </label>
              {editable ? (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving || loading}
                  className="inline-flex items-center gap-1 rounded bg-[#0070d2] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save Week"}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                  <Lock className="h-3.5 w-3.5" />
                  Locked week
                </span>
              )}
            </div>
          </div>

          {message ? <p className="mb-3 text-xs text-emerald-700">{message}</p> : null}
          {error ? <p className="mb-3 text-xs text-rose-700">{error}</p> : null}

          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-[1080px] w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="sticky left-0 z-10 border border-slate-200 bg-slate-100 p-2 text-left">
                      Services Lead
                    </th>
                    <th className="border border-slate-200 p-2 text-right">
                      Amount (USD)
                      <div className="text-[10px] font-normal normal-case tracking-normal text-slate-500">
                        {formatWeekLabel(selectedWeek)}
                      </div>
                    </th>
                    {previousWeeks.map((week) => (
                      <th key={week} className="border border-slate-200 p-2 text-right">
                        Previous (USD)
                        <div className="text-[10px] font-normal normal-case tracking-normal text-slate-500">
                          {formatWeekLabel(week)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white text-slate-800">
                  {sortedLeaders.map((leader) => (
                    <tr key={leader} className="border-t border-slate-100">
                      <td className="sticky left-0 z-[1] bg-white p-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{leader}</span>
                          <button
                            type="button"
                            onClick={() => onRemoveLeader(leader)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
                            title={`Remove ${leader}`}
                          >
                            <Trash2 className="h-3 w-3" />
                            Remove
                          </button>
                        </div>
                      </td>
                      <td className="p-1">
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1 text-right text-sm font-medium text-slate-800 focus:border-slate-300 focus:outline-none disabled:bg-slate-100"
                          inputMode="decimal"
                          value={draft[leader] ?? ""}
                          onChange={(e) => setDraft((prev) => ({ ...prev, [leader]: e.target.value }))}
                          placeholder="0"
                          disabled={!editable || loading}
                        />
                      </td>
                      {previousWeeks.map((week) => (
                        <td key={`${leader}-${week}`} className="p-1">
                          <input
                            className="w-full rounded border border-slate-100 bg-slate-50 px-2 py-1 text-right text-sm font-medium text-slate-700"
                            value={String(weeks[week]?.[leader] ?? 0)}
                            readOnly
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-[13px]">
                  <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                    <td className="sticky left-0 z-[1] bg-slate-50 p-2 uppercase tracking-wide">Total</td>
                    <td className="p-2 text-right">{CURRENCY.format(selectedTotal)}</td>
                    {previousWeeks.map((week) => {
                      const total = sortedLeaders.reduce(
                        (sum, leader) => sum + Number(weeks[week]?.[leader] ?? 0),
                        0
                      );
                      return (
                        <td key={`total-${week}`} className="p-2 text-right">
                          {CURRENCY.format(total)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            <aside className="space-y-3 xl:sticky xl:top-[84px] xl:self-start">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Selected Week Total</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{CURRENCY.format(selectedTotal)}</p>
              </div>

              {previousTotals.length ? (
                <div className="space-y-2">
                  {previousTotals.map((item) => (
                    <div key={item.week} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        {formatWeekLabel(item.week)} Total
                      </p>
                      <p className="mt-0.5 text-lg font-semibold text-slate-900">{CURRENCY.format(item.total)}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 text-xs font-medium text-slate-700">Services Lead Roster</p>
                <div className="flex gap-2">
                  <input
                    value={newLeader}
                    onChange={(e) => setNewLeader(e.target.value)}
                    placeholder="Add services lead"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={onAddLeader}
                    className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <BarChart3 className="h-4 w-4" />
                  Weekly Trend
                </p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={trend}>
                      <CartesianGrid {...HCL_CHART_GRID} />
                      <XAxis dataKey="week" />
                      <YAxis />
                      <Tooltip formatter={(value) => CURRENCY.format(Number(value ?? 0))} {...HCL_CHART_TOOLTIP} />
                      <Line type="monotone" dataKey="total" stroke="#0070d2" strokeWidth={3} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
