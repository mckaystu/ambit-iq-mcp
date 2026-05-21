import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@tremor/react";
import { FlaskConical, Shield, Sparkles } from "lucide-react";
import { PRODUCT_NAME } from "./brand";
import {
  buildDeployShadowRequest,
  buildGenerateRequest,
  buildShadowImpactRequest,
  buildVimlPreviewRequest,
  postPolicyManager,
} from "./policyManagerApi";

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type GenerateState =
  | {
      ok: true;
      rego_code: string;
      rule_logic: Record<string, unknown>;
      rule_name: string;
      original_intent: string;
      source?: string;
      model?: string;
      warnings?: string[];
      /** Present when request included non-empty `viml` and YAML validated on server. */
      viml_preview?: Record<string, unknown>;
    }
  | { ok: false; error: string }
  | null;

type DeployState = { ok: true; rule_id: string } | { ok: false; error: string } | null;

type ImpactState =
  | {
      ok: true;
      flagged_total: number;
      flagged_agent: number;
      flagged_human: number;
      rows_scanned: number;
      hours: number;
      impact_mode?: "regex" | "viml" | "enforce_patterns";
      note?: string;
    }
  | { ok: false; error: string }
  | null;

async function generatePolicyAction(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const intent = String(formData.get("intent") || "").trim();
  const viml = String(formData.get("viml") || "");
  if (!intent) return { ok: false, error: "Describe your policy intent in plain English." };
  const result = await postPolicyManager(buildGenerateRequest(intent, viml));
  if (!result.ok) return { ok: false, error: result.error };
  const j = result.data;
  const vimlPreview =
    j.viml_preview && typeof j.viml_preview === "object" ? (j.viml_preview as Record<string, unknown>) : undefined;
  return {
    ok: true,
    rego_code: String(j.rego_code || ""),
    rule_logic: (j.rule_logic as Record<string, unknown>) || {},
    rule_name: String(j.rule_name || ""),
    original_intent: String(j.original_intent || intent),
    source: j.source != null ? String(j.source) : undefined,
    model: j.model != null ? String(j.model) : undefined,
    warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : undefined,
    ...(vimlPreview ? { viml_preview: vimlPreview } : {}),
  };
}

async function deployShadowAction(_prev: DeployState, formData: FormData): Promise<DeployState> {
  const original_intent = String(formData.get("original_intent") || "").trim();
  const rego_code = String(formData.get("rego_code") || "").trim();
  const rule_name = String(formData.get("rule_name") || "").trim();
  const viml = String(formData.get("viml") || "");
  let rule_logic: Record<string, unknown>;
  try {
    rule_logic = JSON.parse(String(formData.get("rule_logic_json") || "{}")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "rule_logic JSON is invalid." };
  }
  if (!rego_code) return { ok: false, error: "Generate or paste Rego before deploying." };
  const result = await postPolicyManager(
    buildDeployShadowRequest({
      original_intent,
      rego_code,
      rule_name: rule_name || "Untitled shadow rule",
      rule_logic,
      viml,
    }),
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, rule_id: String(result.data.rule_id || "") };
}

export default function PolicyManager() {
  const [genState, generateAction, isGeneratePending] = useActionState(generatePolicyAction, null);
  const [deployState, deployAction, isDeployPending] = useActionState(deployShadowAction, null);
  const [impact, setImpact] = useState<ImpactState>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [vimlYaml, setVimlYaml] = useState("");
  const [vimlServerBlock, setVimlServerBlock] = useState<Record<string, unknown> | null>(null);
  const [vimlPreviewLoading, setVimlPreviewLoading] = useState(false);
  const [vimlPreviewError, setVimlPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (genState?.ok && genState.viml_preview) {
      setVimlServerBlock(genState.viml_preview);
      setVimlPreviewError(null);
    }
  }, [genState]);

  const runVimlPreview = useCallback(async () => {
    const raw = vimlYaml.trim();
    if (!raw) {
      setVimlPreviewError("Paste VIML YAML first.");
      setVimlServerBlock(null);
      return;
    }
    setVimlPreviewLoading(true);
    setVimlPreviewError(null);
    try {
      const sample_code =
        genState?.ok && genState.rego_code.trim() ? genState.rego_code.slice(0, 8000) : undefined;
      const result = await postPolicyManager(buildVimlPreviewRequest(raw, sample_code));
      if (!result.ok) {
        setVimlServerBlock(null);
        setVimlPreviewError(result.error);
        return;
      }
      const j = result.data;
      const p = j.viml_preview && typeof j.viml_preview === "object" ? (j.viml_preview as Record<string, unknown>) : null;
      setVimlServerBlock(p);
    } catch (e) {
      setVimlServerBlock(null);
      setVimlPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setVimlPreviewLoading(false);
    }
  }, [vimlYaml, genState]);

  const vibePreview = useMemo(() => {
    if (!genState?.ok) {
      const serverOnly =
        vimlServerBlock && Object.keys(vimlServerBlock).length
          ? ["Server (MCP-aligned VIML summary)", "", JSON.stringify(vimlServerBlock, null, 2)].join("\n")
          : "Generate a policy to preview the agent-facing deny narrative, or validate VIML on the server.";
      return serverOnly;
    }
    const desc = String((genState.rule_logic as { description?: string }).description || "Policy violation.");
    const serverLines =
      vimlServerBlock && Object.keys(vimlServerBlock).length
        ? ["", "--- Server (MCP-aligned VIML summary) ---", JSON.stringify(vimlServerBlock, null, 2)]
        : [];
    return [
      "Project Vail — Vibe preview (coding agent view on DENY)",
      "",
      `Intent: ${genState.original_intent}`,
      "",
      `On failure: ${desc}`,
      "",
      "--- Generated Rego (excerpt) ---",
      genState.rego_code.length > 4000 ? `${genState.rego_code.slice(0, 4000)}\n…` : genState.rego_code,
      "",
      "VIML: sent with Generate / Deploy / Impact; use Validate on server for MCP-aligned fields without generating.",
      ...serverLines,
    ].join("\n");
  }, [genState, vimlServerBlock]);

  const regoDisplay = genState?.ok ? genState.rego_code : "";
  const ruleLogicJson = useMemo(() => {
    if (genState?.ok) return JSON.stringify(genState.rule_logic, null, 2);
    return "";
  }, [genState]);

  const runImpact = useCallback(async () => {
    if (!genState?.ok) return;
    setImpactLoading(true);
    setImpact(null);
    try {
      const result = await postPolicyManager(
        buildShadowImpactRequest({
          rego_code: genState.rego_code,
          hours: 24,
          viml: vimlYaml,
        }),
      );
      if (!result.ok) {
        setImpact({ ok: false, error: result.error });
        return;
      }
      const j = result.data;
      setImpact({
        ok: true,
        flagged_total: Number(j.flagged_total || 0),
        flagged_agent: Number(j.flagged_agent || 0),
        flagged_human: Number(j.flagged_human || 0),
        rows_scanned: Number(j.rows_scanned || 0),
        hours: Number(j.hours || 24),
        impact_mode:
          j.impact_mode === "viml" || j.impact_mode === "enforce_patterns" || j.impact_mode === "regex"
            ? j.impact_mode
            : undefined,
        note: j.note ? String(j.note) : undefined,
      });
    } catch (e) {
      setImpact({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setImpactLoading(false);
    }
  }, [genState, vimlYaml]);

  return (
    <div className="space-y-8 pb-12">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-slate-100/60 shadow-sm dark:border-slate-700/90 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-hcl-blue to-[#4589ff]" aria-hidden />
        <div className="relative px-5 py-7 pl-6 sm:px-8 sm:pl-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-hcl-blue/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] text-hcl-blue dark:bg-hcl-blue/20">
              <Shield className="h-3.5 w-3.5" strokeWidth={2} />
              HCL Software
            </span>
            <span className="text-xs font-medium text-carbon-text-secondary dark:text-slate-500">{PRODUCT_NAME}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-hcl-blue text-white shadow-md shadow-hcl-blue/25">
              <FlaskConical className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Policy editor</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Generate OPA Rego from plain English, measure impact on recent{" "}
                <code className="rounded-md bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">ambit_decision_logs</code>, then
                deploy as{" "}
                <Badge color="amber" className="align-middle font-normal">
                  shadow
                </Badge>{" "}
                — surfaced as <strong>virtual violations</strong> in audits (non-blocking).
              </p>
            </div>
          </div>
        </div>
      </section>

      <form action={generateAction} className="space-y-4">
        <input type="hidden" name="viml" value={vimlYaml} aria-hidden />
        <div className="grid min-h-[min(22rem,52vh)] gap-8 xl:grid-cols-2 xl:items-stretch 2xl:grid-cols-3">
          <Card className="flex h-full min-h-0 flex-col rounded-2xl border-slate-200/90 p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
            <div className="flex shrink-0 items-center gap-2 text-hcl-blue">
              <Sparkles className="h-5 w-5" strokeWidth={1.75} />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Plain English intent</h3>
            </div>
            <label className="mt-4 flex min-h-0 flex-1 flex-col text-sm font-medium text-slate-700 dark:text-slate-200">
              <span className="shrink-0">Describe the policy you want in natural language.</span>
              <textarea
                name="intent"
                required
                className={cls(
                  "mt-2 min-h-0 flex-1 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition",
                  "placeholder:text-slate-400 focus:border-hcl-blue focus:ring-2 focus:ring-hcl-blue/20",
                  "dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100",
                )}
                placeholder=""
                defaultValue=""
              />
            </label>
          </Card>

          <Card className="flex h-full min-h-0 flex-col rounded-2xl border-slate-200/90 p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Generated Rego</h3>
              {genState?.ok && genState.source === "openai" ? (
                <Badge color="emerald" className="font-normal">
                  OpenAI · {genState.model || "gpt-4o-mini"}
                </Badge>
              ) : null}
            </div>
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
              <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
                {regoDisplay ? (
                  <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-sky-100">{regoDisplay}</pre>
                ) : (
                  <p className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
                    Generate a policy to see Rego output.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <Card className="flex h-full min-h-0 flex-col rounded-2xl border-slate-200/90 p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">VIML (optional)</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              YAML envelope for MCP <code className="font-mono">viml</code> on <code className="font-mono">audit_vibe</code> /{" "}
              <code className="font-mono">log_vibe_transaction</code>. See repo <code className="font-mono">examples/agent-gate/sample.viml</code>.
              This value is POSTed with Generate, Deploy, and Impact; validate below to round-trip with the same parser as the MCP.
            </p>
            <label className="mt-3 flex min-h-0 flex-1 flex-col text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="shrink-0">Paste or edit VIML YAML</span>
              <textarea
                data-testid="policy-editor-viml"
                aria-label="VIML policy envelope (YAML)"
                value={vimlYaml}
                onChange={(e) => setVimlYaml(e.target.value)}
                spellCheck={false}
                className={cls(
                  "mt-2 min-h-[8rem] flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-900 shadow-sm outline-none transition",
                  "placeholder:text-slate-400 focus:border-hcl-blue focus:ring-2 focus:ring-hcl-blue/20",
                  "dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100",
                )}
                placeholder={'vibe:\n  intent: "..."\n  profile: baseline.global'}
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="text-xs"
                onClick={() => void runVimlPreview()}
                disabled={!vimlYaml.trim() || vimlPreviewLoading}
                loading={vimlPreviewLoading}
              >
                Validate on server
              </Button>
              {vimlPreviewError ? (
                <span className="self-center text-xs font-medium text-red-600 dark:text-red-400">{vimlPreviewError}</span>
              ) : null}
            </div>
            <div className="mt-4 shrink-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-hcl-blue">Vibe preview</p>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                {vibePreview}
              </pre>
            </div>
          </Card>
        </div>
        {genState && !genState.ok ? (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{genState.error}</p>
        ) : null}
        {genState?.ok && Array.isArray(genState.warnings) && genState.warnings.length ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-semibold">Generator recovery notes</p>
            <ul className="mt-1 list-disc pl-5">
              {genState.warnings.map((w, i) => (
                <li key={`${i}-${w}`}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={isGeneratePending} disabled={isGeneratePending}>
            Generate policy
          </Button>
        </div>
      </form>

      <Card className="rounded-2xl border-slate-200/90 p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Impact on recent decisions</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Scans <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">ambit_decision_logs.proposed_code</code> from
              the last 24 hours. If you pasted VIML YAML above, the server uses the same <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">enforce</code> fast-path as the MCP; otherwise it uses the regex from{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800"># AGENT_GATE:test</code> (or{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800"># AMBIT:test</code>).
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => void runImpact()}
            disabled={!genState?.ok || impactLoading}
            loading={impactLoading}
          >
            Run impact scan
          </Button>
        </div>
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5 dark:border-slate-800">
          {impact && !impact.ok ? <p className="text-sm text-red-600 dark:text-red-400">{impact.error}</p> : null}
          {impact?.ok ? (
            <div className="rounded-xl border border-hcl-blue/25 bg-hcl-blue/[0.06] p-5 dark:bg-hcl-blue/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-hcl-blue">Impact summary</p>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                This rule would have matched{" "}
                <span className="text-hcl-blue">{impact.flagged_total}</span> decision log
                {impact.flagged_total === 1 ? "" : "s"} in the last {impact.hours}h
                {impact.rows_scanned ? ` (scanned ${impact.rows_scanned})` : ""}.
                {impact.impact_mode ? (
                  <span className="mt-1 block text-xs font-normal uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Mode: {impact.impact_mode.replaceAll("_", " ")}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                <span className="font-semibold">{impact.flagged_agent}</span> classified as agent actions ·{" "}
                <span className="font-semibold">{impact.flagged_human}</span> as human actions
                <span className="text-slate-500 dark:text-slate-400"> (heuristic from metadata / actor_id).</span>
              </p>
              {impact.note ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-200/90">{impact.note}</p> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="rounded-2xl border-slate-200/90 p-6 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Deploy to shadow</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Saves to <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">rules_library</code> with{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">status = shadow</code>. Active audits ignore shadow
          rules for blocking; matches appear as virtual violations in MCP audit text.
        </p>
        {deployState?.ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
            Deployed shadow rule <span className="font-mono text-xs">{deployState.rule_id}</span>. Refresh MCP rules cache to load immediately.
          </div>
        ) : null}
        {deployState && !deployState.ok ? (
          <p className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">{deployState.error}</p>
        ) : null}
        <form action={deployAction} className="mt-5 space-y-4">
          <input type="hidden" name="original_intent" value={genState?.ok ? genState.original_intent : ""} />
          <input type="hidden" name="rego_code" value={regoDisplay} />
          <input type="hidden" name="rule_name" value={genState?.ok ? genState.rule_name : ""} />
          <input type="hidden" name="rule_logic_json" value={ruleLogicJson} />
          <input type="hidden" name="viml" value={vimlYaml} aria-hidden />
          <Button type="submit" variant="primary" disabled={!genState?.ok || isDeployPending} loading={isDeployPending}>
            Deploy to shadow
          </Button>
        </form>
      </Card>
    </div>
  );
}
