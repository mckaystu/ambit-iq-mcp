"use client";

import { useEffect, useState } from "react";

import CsvUpload from "@/components/csv-upload";
import UtilizationUpload from "@/components/utilization-upload";

export default function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const loadSession = async () => {
    try {
      setChecking(true);
      const response = await fetch("/api/admin/session", { cache: "no-store" });
      const body = (await response.json()) as { authenticated?: boolean; configured?: boolean };
      setAuthenticated(Boolean(body.authenticated));
      setConfigured(Boolean(body.configured));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const login = async () => {
    try {
      setWorking(true);
      setError(null);
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Invalid token.");
      setToken("");
      await loadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setWorking(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    await loadSession();
  };

  return (
    <main className="min-h-screen bg-[#0f172a] px-4 py-8 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5 shadow-sm">
          <h1 className="text-lg font-semibold">Admin Uploads</h1>
          <p className="mt-1 text-sm text-slate-300">
            All dashboard file uploads are managed here. Access requires the configured bearer token.
          </p>
        </section>

        {!configured ? (
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            `BEARER_TOKEN` is not configured in environment variables. Set it to enable admin access control.
          </section>
        ) : null}

        {checking ? (
          <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
            Checking admin session...
          </section>
        ) : authenticated ? (
          <>
            <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Upload Center</h2>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                >
                  Logout
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-slate-700 bg-slate-950/40 p-3">
                  <p className="mb-2 text-xs text-slate-300">Bookings Weekly Report</p>
                  <CsvUpload />
                </div>
                <div className="rounded border border-slate-700 bg-slate-950/40 p-3">
                  <p className="mb-2 text-xs text-slate-300">Utilization Timesheet</p>
                  <UtilizationUpload kind="timesheet" />
                </div>
                <div className="rounded border border-slate-700 bg-slate-950/40 p-3 md:col-span-2">
                  <p className="mb-2 text-xs text-slate-300">Utilization Resource Master</p>
                  <UtilizationUpload kind="resource" />
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
            <h2 className="text-sm font-semibold">Authenticate</h2>
            <p className="mt-1 text-xs text-slate-400">Enter bearer token to access admin uploads.</p>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                placeholder="Bearer token"
              />
              <button
                type="button"
                onClick={login}
                disabled={working || !token.trim()}
                className="rounded bg-[#0070d2] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {working ? "Checking..." : "Unlock"}
              </button>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
          </section>
        )}
      </div>
    </main>
  );
}
