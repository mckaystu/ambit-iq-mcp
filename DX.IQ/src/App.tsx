import { useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, ChevronRight, Database, Loader2, Network, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const STORAGE_KEYS = {
  baseUrl: "dxiq.baseUrl",
  contenthandlerPath: "dxiq.contenthandlerPath",
  localLibraries: "dxiq.localLibraries"
} as const;

type SavedLibrary = {
  id: number;
  name: string;
  baseUrl: string;
  username: string;
  hasPassword: boolean;
};

type LibraryAnalytics = {
  libraryId: number;
  libraryName: string;
  inventory: {
    pt_count: number;
    at_count: number;
    sitearea_count: number;
    content_count: number;
    component_count: number;
    library_count: number;
    folder_count: number;
  };
  linksCount: number;
  /** REFERENCES edges where parent type is Content (WCM item reference mining). */
  referencesFromContentCount: number;
  referencesFromPtCount: number;
  deadWoodCount: number;
  deadWoodItems: Array<{
    id: number;
    name: string;
    wcm_id: string;
    type: string;
  }>;
};

type GraphHealth = {
  loading: boolean;
  enabled: boolean;
  status: "unknown" | "disabled" | "healthy" | "error";
  message: string;
};

type GraphNode = {
  id: number;
  wcmId: string;
  name: string;
  type: string;
  inbound: number;
  outbound: number;
  isUnused: boolean;
};

type GraphEdge = {
  fromId: number;
  fromName: string;
  fromType: string;
  toId: number;
  toName: string;
  toType: string;
  type: string;
};

type GraphHierarchyRow = {
  ptId: number;
  ptName: string;
  children: Array<{ id: number; name: string; type: string }>;
};

type GraphSubgraph = {
  loading: boolean;
  error: string;
  libraryId: number | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hierarchy: GraphHierarchyRow[];
  story: {
    headline: string;
    detail: string;
    ptCount: number;
    componentCount: number;
  } | null;
  summary: {
    nodes: number;
    edges: number;
    unusedComponents: number;
    truncated: boolean;
  };
};

type PositionedNode = GraphNode & { x: number; y: number };

const isLocalViteDev = import.meta.env.DEV;
const SESSION_DEFAULT_CONTENTHANDLER_PATH = "/dx/api/wcm/v2/libraries";
const BASIC_DEFAULT_CONTENTHANDLER_PATH = "/hcl/mycontenthandler/wcmrest-v2/libraries";

/** When the local API is not running, browser fetch to /api often fails with a generic network error. */
function localApiUnreachableHints(originalMessage: string): string {
  const m = originalMessage.toLowerCase();
  const looksLikeApiDown =
    m.includes("failed to fetch") ||
    m.includes("load failed") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("econnrefused") ||
    m.includes("fetch failed");
  if (!looksLikeApiDown || !isLocalViteDev) return originalMessage;
  return (
    `${originalMessage}\n\n` +
    `The DX.IQ backend was not reachable. In local dev, Vite proxies /api to http://localhost:8787. ` +
    `Run npm run dev:api in another terminal, or use npm run dev:all to start the API and UI together.`
  );
}

function buildGraphLayout(nodes: GraphNode[]): PositionedNode[] {
  /** Analytics lanes aligned with HCL hierarchy: DocumentLibrary → SiteArea → Content → templates → Component */
  const lanes = ["Library", "SiteArea", "Content", "AT", "PT", "Component"];
  const laneIndex = new Map<string, number>(lanes.map((lane, i) => [lane, i]));
  const grouped = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const idx = laneIndex.get(n.type) ?? lanes.length;
    const arr = grouped.get(idx) || [];
    arr.push(n);
    grouped.set(idx, arr);
  }
  const out: PositionedNode[] = [];
  const laneSpacingX = 180;
  const rowSpacingY = 64;
  for (const [idx, arr] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    arr.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));
    arr.forEach((n, i) => {
      out.push({
        ...n,
        x: 90 + idx * laneSpacingX,
        y: 50 + i * rowSpacingY
      });
    });
  }
  return out;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const compact = (input: unknown, depth = 0): unknown => {
    if (input === null || input === undefined) return input;
    if (typeof input === "string") return input.length > 2000 ? `${input.slice(0, 2000)}...[truncated]` : input;
    if (typeof input !== "object") return input;
    if (depth > 5) return "[truncated-depth]";
    if (seen.has(input as object)) return "[circular]";
    seen.add(input as object);
    if (Array.isArray(input)) {
      const head = input.slice(0, 50).map((v) => compact(v, depth + 1));
      return input.length > 50 ? [...head, `[${input.length - 50} more items truncated]`] : head;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = compact(v, depth + 1);
    }
    return out;
  };
  return JSON.stringify(compact(value), null, 2);
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState("https://riesen-dev-latest.team-q-dev.com");
  const [authMode, setAuthMode] = useState<"basic" | "session">("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionCookieInput, setSessionCookieInput] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [sessionBootstrapping, setSessionBootstrapping] = useState(false);
  const [contenthandlerPath, setContenthandlerPath] = useState(BASIC_DEFAULT_CONTENTHANDLER_PATH);
  const [busy, setBusy] = useState<"none" | "connection" | "scan">("none");
  const [result, setResult] = useState<string>("");
  const [scanJobId, setScanJobId] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    state: string;
    libraryName: string;
    libraryOrdinal: number;
    libraryTotal: number;
    aggregateItemsFetched: number;
    currentIndex: number;
    targetCount: number;
    endpointTargetCount: number;
    itemsFetched: number;
    totalItemsHint: number;
    fetchedPages: number;
    endpointItemCounts: Record<string, number>;
    scanPhase?: string;
    contentEnrichQueued?: number;
    contentEnrichDone?: number;
  } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [analyzeBanner, setAnalyzeBanner] = useState("");
  const [discoveredLibraries, setDiscoveredLibraries] = useState<string[]>([]);
  const [selectedDiscoveredLibraries, setSelectedDiscoveredLibraries] = useState<string[]>([]);
  const [discoveryIssue, setDiscoveryIssue] = useState<string>("");
  const [discoveryAttempts, setDiscoveryAttempts] = useState<
    Array<{ path: string; status: number; contentType: string; portalHtmlFallback?: boolean }>
  >([]);
  const [libraries, setLibraries] = useState<
    SavedLibrary[]
  >([]);
  const [analyticsByLibrary, setAnalyticsByLibrary] = useState<Record<string, LibraryAnalytics>>({});
  const [selectedAnalyticsLibrary, setSelectedAnalyticsLibrary] = useState("");
  const lowMemoryMode = true;
  const [graphHealth, setGraphHealth] = useState<GraphHealth>({
    loading: false,
    enabled: false,
    status: "unknown",
    message: "Checking graph ingest status..."
  });
  const [graphSubgraph, setGraphSubgraph] = useState<GraphSubgraph>({
    loading: false,
    error: "",
    libraryId: null,
    nodes: [],
    edges: [],
    hierarchy: [],
    story: null,
    summary: { nodes: 0, edges: 0, unusedComponents: 0, truncated: false }
  });
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<number | null>(null);
  const [graphZoom, setGraphZoom] = useState(1);
  const [showTechnicalView, setShowTechnicalView] = useState(false);
  const [showResponsePayload, setShowResponsePayload] = useState(false);
  const [showDiscoveryDiagnostics, setShowDiscoveryDiagnostics] = useState(false);
  const [discoveredSearch, setDiscoveredSearch] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  /** Avoid overwriting localStorage with default state before hydrate-from-storage runs. */
  const skipPersistBaseUrl = useRef(true);
  const skipPersistContenthandlerPath = useRef(true);

  const parseApiResponse = async (res: Response) => {
    const raw = await res.text();
    try {
      return JSON.parse(raw);
    } catch {
      // Calls in this app target `/api/*` only. Our handlers return JSON; a 404 + parse failure
      // is almost always local API not running, a bad deploy URL, or a plain-text/HTML 404 body.
      const missingApiRoute = res.status === 404;
      return {
        ok: false,
        error: missingApiRoute
          ? "API route not found (404). Start local API with `npm run dev:api` and UI with `npm run dev`."
          : "Non-JSON response from API",
        hint: missingApiRoute
          ? "Run `npm run dev:api` in one terminal and `npm run dev` in another."
          : undefined,
        status: res.status,
        statusText: res.statusText,
        raw: raw.slice(0, 2000)
      };
    }
  };

  const loadLocalLibraries = (): SavedLibrary[] => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.localLibraries);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: Number((x as { id?: number }).id || 0),
          name: String((x as { name?: string }).name || ""),
          baseUrl: String((x as { baseUrl?: string }).baseUrl || ""),
          username: String((x as { username?: string }).username || ""),
          hasPassword: Boolean((x as { hasPassword?: boolean }).hasPassword)
        }))
        .filter((x) => x.id > 0 && x.name && x.baseUrl)
        .slice(0, 100);
    } catch {
      return [];
    }
  };

  const saveLocalLibraries = (items: SavedLibrary[]) => {
    window.localStorage.setItem(STORAGE_KEYS.localLibraries, JSON.stringify(items.slice(0, 100)));
  };

  const establishSessionFromLogin = async (): Promise<{ ok?: boolean; sessionToken?: string } | null> => {
    setSessionBootstrapping(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          username,
          password,
          sessionCookie: sessionCookieInput,
          verifyPath: SESSION_DEFAULT_CONTENTHANDLER_PATH
        })
      });
      const json = await parseApiResponse(res);
      if (json?.ok && typeof json.sessionToken === "string") {
        setSessionToken(json.sessionToken);
      } else {
        const err = typeof json?.error === "string" ? json.error : "Session bootstrap failed.";
        setDiscoveryIssue(err);
        setResult(safeStringify(json));
      }
      return json;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const enriched = localApiUnreachableHints(details);
      setDiscoveryIssue(enriched);
      setResult(
        safeStringify({
          ok: false,
          error: "Session bootstrap failed",
          details: enriched
        })
      );
      return null;
    } finally {
      setSessionBootstrapping(false);
    }
  };

  const runProbe = async () => {
    setBusy("connection");
    setResult("");
    try {
      let activeSessionToken = sessionToken;
      if (authMode === "session") {
        if (!baseUrl || ((!username || !password) && !sessionCookieInput.trim())) {
          setResult(
            safeStringify({
              ok: false,
              error: "Session Auth requires username/password or a session cookie."
            })
          );
          return;
        }
        const sessionJson = await establishSessionFromLogin();
        if (!sessionJson?.ok || typeof sessionJson.sessionToken !== "string") return;
        activeSessionToken = sessionJson.sessionToken;
      }

      const endpoint = "/api/libraries/test-connection";
      const payload = {
        name: "DX.IQ Discovery",
        baseUrl,
        username: authMode === "basic" ? username : "",
        password: authMode === "basic" ? password : "",
        sessionToken: authMode === "session" ? activeSessionToken : "",
        contenthandlerPath
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await parseApiResponse(res);
      if (authMode === "session" && json?.ok) {
        setResult(
          safeStringify({
            ...json,
            status: "Session established"
          })
        );
      } else {
        setResult(safeStringify(json));
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setResult(
        JSON.stringify(
          {
            ok: false,
            error: "Probe failed",
            details: localApiUnreachableHints(details)
          },
          null,
          2
        )
      );
    } finally {
      setBusy("none");
    }
  };

  const refreshGraphHealth = async () => {
    setGraphHealth((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch("/api/graph/health");
      const json = await parseApiResponse(res);
      setGraphHealth({
        loading: false,
        enabled: Boolean(json?.enabled),
        status:
          json?.status === "disabled" || json?.status === "healthy" || json?.status === "error"
            ? json.status
            : "unknown",
        message: typeof json?.message === "string" ? json.message : "Unable to determine graph status."
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setGraphHealth({
        loading: false,
        enabled: false,
        status: "error",
        message: localApiUnreachableHints(details)
      });
    }
  };

  const ensureLibrary = async (
    libraryName: string
  ): Promise<{ ok: true; library: SavedLibrary } | { ok: false; message: string }> => {
    const existing = libraries.find((l) => l.name === libraryName);
    if (existing) return { ok: true, library: existing };

    const res = await fetch("/api/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: libraryName,
        baseUrl,
        username: authMode === "basic" ? username : "",
        password: authMode === "basic" ? password : "",
        sessionToken: authMode === "session" ? sessionToken : ""
      })
    });
    const json = await parseApiResponse(res);
    if (!json.ok || !json.library?.id) {
      const apiErr =
        typeof json.error === "string"
          ? json.error
          : res.ok
            ? "Library was not created"
            : `Request failed (${res.status})`;
      const extra = typeof json.details === "string" ? ` — ${json.details}` : "";
      let fix = "";
      if (/DATABASE_URL/i.test(apiErr)) {
        fix =
          " Add DATABASE_URL to .env.local (Neon connection string), run db/schema.sql on that database, then restart npm run dev:api.";
      }
      return { ok: false, message: `${apiErr}${extra}.${fix}` };
    }

    const created = json.library as SavedLibrary;
    setLibraries((prev) => {
      if (prev.some((x) => x.id === created.id)) return prev;
      const next = [...prev, created];
      saveLocalLibraries(next);
      return next;
    });
    return { ok: true, library: created };
  };

  const loadLibraryAnalytics = async (
    libraryId: number,
    fallbackName: string,
    jobId?: number,
    deadWoodLimit = 250
  ) => {
    const deadWoodRes = await fetch(`/api/reports/dead-wood?libraryId=${libraryId}&limit=${deadWoodLimit}`);
    const deadWoodJson = await parseApiResponse(deadWoodRes);
    const statusRes = jobId
      ? await fetch(`/api/scan/status?jobId=${jobId}`)
      : null;
    const statusJson = statusRes ? await parseApiResponse(statusRes) : null;

    const jobLibraryName =
      typeof statusJson?.job?.libraryName === "string" ? statusJson.job.libraryName : fallbackName;

    const inventory = {
      pt_count: Number(statusJson?.inventory?.pt_count || 0),
      at_count: Number(statusJson?.inventory?.at_count || 0),
      sitearea_count: Number(statusJson?.inventory?.sitearea_count || 0),
      content_count: Number(statusJson?.inventory?.content_count || 0),
      component_count: Number(statusJson?.inventory?.component_count || 0),
      library_count: Number(statusJson?.inventory?.library_count || 0),
      folder_count: Number(statusJson?.inventory?.folder_count || 0)
    };

    return {
      libraryId,
      libraryName: jobLibraryName,
      inventory,
      linksCount: Number(statusJson?.relationships?.linksCount || 0),
      referencesFromContentCount: Number(statusJson?.relationships?.referencesFromContentCount || 0),
      referencesFromPtCount: Number(statusJson?.relationships?.referencesFromPtCount || 0),
      deadWoodCount: Number(deadWoodJson?.count || 0),
      deadWoodItems: Array.isArray(deadWoodJson?.items) ? deadWoodJson.items.slice(0, deadWoodLimit) : []
    } as LibraryAnalytics;
  };

  const loadGraphSubgraph = async (libraryId: number) => {
    setGraphSubgraph((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const res = await fetch(`/api/graph/subgraph?libraryId=${libraryId}&limit=1000`);
      const json = await parseApiResponse(res);
      if (!json?.ok) {
        const message =
          typeof json?.error === "string"
            ? json.error
            : typeof json?.details === "string"
              ? json.details
              : "Failed to load relationship graph";
        setGraphSubgraph((prev) => ({ ...prev, loading: false, error: message, story: null }));
        return;
      }
      const s = json.story;
      const story =
        s && typeof s === "object" && typeof s.headline === "string" && typeof s.detail === "string"
          ? {
              headline: s.headline,
              detail: s.detail,
              ptCount: Number(s.ptCount || 0),
              componentCount: Number(s.componentCount || 0)
            }
          : null;
      setGraphSubgraph({
        loading: false,
        error: "",
        libraryId,
        nodes: Array.isArray(json.nodes) ? json.nodes : [],
        edges: Array.isArray(json.edges) ? json.edges : [],
        hierarchy: Array.isArray(json.hierarchy) ? json.hierarchy : [],
        story,
        summary: {
          nodes: Number(json?.summary?.nodes || 0),
          edges: Number(json?.summary?.edges || 0),
          unusedComponents: Number(json?.summary?.unusedComponents || 0),
          truncated: Boolean(json?.summary?.truncated)
        }
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setGraphSubgraph((prev) => ({
        ...prev,
        loading: false,
        error: localApiUnreachableHints(details),
        story: null
      }));
    }
  };

  const discoverLibraries = async () => {
    setDiscovering(true);
    setResult("");
    try {
      let activeSessionToken = sessionToken;
      if (authMode === "session") {
        if (!baseUrl || ((!username || !password) && !sessionCookieInput.trim())) {
          setDiscoveryIssue("Session Auth requires username/password or a session cookie.");
          return;
        }
        const sessionJson = await establishSessionFromLogin();
        if (!sessionJson?.ok || typeof sessionJson.sessionToken !== "string") return;
        activeSessionToken = sessionJson.sessionToken;
      }

      const res = await fetch("/api/libraries/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          username: authMode === "basic" ? username : "",
          password: authMode === "basic" ? password : "",
          sessionToken: authMode === "session" ? activeSessionToken : "",
          contenthandlerPath
        })
      });
      const json = await parseApiResponse(res);
      setResult(safeStringify(json));
      if (json.ok) {
        const libs: string[] = Array.isArray(json.libraries) ? json.libraries : [];
        setDiscoveredLibraries(libs);
        setSelectedDiscoveredLibraries((prev) => prev.filter((x) => libs.includes(x)));
        setDiscoveryAttempts(
          Array.isArray(json.attempts)
            ? json.attempts.map((a: Record<string, unknown>) => ({
                path: String(a.path || ""),
                status: Number(a.status || 0),
                contentType: String(a.contentType || ""),
                portalHtmlFallback: Boolean(a.portalHtmlFallback)
              }))
            : []
        );
        if (libs.length === 0) {
          const hint = typeof json.hint === "string" ? json.hint : "No libraries returned by discovery.";
          const suggestedContenthandlerPath =
            typeof json.suggestedContenthandlerPath === "string" ? json.suggestedContenthandlerPath.trim() : "";
          if (json.authLikelyInteractive) {
            setDiscoveryIssue(
              `${hint} Basic auth is likely not sufficient for this DX environment. Use an API-capable account/route or session-backed access.`
            );
          } else {
            setDiscoveryIssue(hint);
          }
          if (suggestedContenthandlerPath) {
            setContenthandlerPath(suggestedContenthandlerPath);
          }
        } else {
          setDiscoveryIssue("");
        }
        if (libs.length === 0) {
          const endpointHints: string[] = Array.isArray(json?.swaggerHint?.endpointHints)
            ? json.swaggerHint.endpointHints
            : [];
          if (endpointHints.length > 0) {
            setContenthandlerPath(endpointHints[0]);
          }
        }
      } else {
        setDiscoveredLibraries([]);
        setDiscoveryAttempts([]);
        const hint = typeof json.hint === "string" ? json.hint : "";
        const err = typeof json.error === "string" ? json.error : "Discovery failed.";
        setDiscoveryIssue(hint ? `${err} ${hint}` : err);
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const enriched = localApiUnreachableHints(details);
      setDiscoveryIssue(enriched !== details ? enriched : "");
      setDiscoveryAttempts([]);
      setResult(
        safeStringify({
          ok: false,
          error: "Discovery failed",
          details: enriched
        })
      );
    } finally {
      setDiscovering(false);
    }
  };

  const toggleDiscoveredLibrary = (name: string) => {
    setSelectedDiscoveredLibraries((prev) => {
      if (prev.includes(name)) return prev.filter((x) => x !== name);
      return [...prev, name];
    });
  };
  const selectVisibleDiscoveredLibraries = (items: string[]) => {
    setSelectedDiscoveredLibraries((prev) => [...new Set([...prev, ...items])]);
  };

  const clearVisibleDiscoveredLibraries = (items: string[]) => {
    if (items.length === 0) return;
    const visible = new Set(items);
    setSelectedDiscoveredLibraries((prev) => prev.filter((x) => !visible.has(x)));
  };

  const generateSessionFromLogin = async () => {
    setResult("");
    const json = await establishSessionFromLogin();
    if (json) setResult(safeStringify(json));
  };

  const runScan = async () => {
    if (selectedDiscoveredLibraries.length === 0) {
      setResult(safeStringify({ ok: false, error: "Select at least one discovered library first." }));
      return;
    }
    setBusy("scan");
    setResult("");
    setAnalyzeBanner("");
    try {
      const runs: unknown[] = [];
      const nextAnalytics: Record<string, LibraryAnalytics> = {};
      const warnings: string[] = [];
      // Chunk size 1 + low maxChunks prevented ever reaching enrich_content on typical libraries (many crawl targets + folders).
      const scanChunkSize = lowMemoryMode ? 2 : 3;
      const maxChunks = lowMemoryMode ? 2500 : 600;
      const deadWoodLimit = lowMemoryMode ? 100 : 250;
      const selectedNames = selectedDiscoveredLibraries;
      if (lowMemoryMode && selectedNames.length > 1) {
        warnings.push(
          `Low-memory mode: scanning ${selectedNames.length} libraries one after another (same memory profile as a single library per run).`
        );
      }

      const toJobId = (jobIdRaw: unknown): number | undefined => {
        if (typeof jobIdRaw === "number" && !Number.isNaN(jobIdRaw)) return jobIdRaw;
        if (typeof jobIdRaw === "string" && jobIdRaw.trim()) {
          const n = Number(jobIdRaw);
          return Number.isNaN(n) ? undefined : n;
        }
        return undefined;
      };

      let aggregateItemsCompleted = 0;
      let currentLibraryOrdinal = 0;
      let currentLibraryName = "";
      let currentLibraryItemsFetched = 0;
      const totalLibraries = selectedNames.length;

      const applyScanProgress = (json: {
        state?: string;
        progress?: {
          currentIndex?: number;
          targetCount?: number;
          endpointTargetCount?: number;
          itemsFetched?: number;
          totalItemsHint?: number;
          fetchedPages?: number;
          endpointItemCounts?: Record<string, number>;
          phase?: string;
          contentEnrichQueued?: number;
          contentEnrichDone?: number;
        };
      }) => {
        if (json?.progress && typeof json.progress === "object") {
          currentLibraryItemsFetched = Number(json.progress.itemsFetched ?? 0);
          const p = json.progress;
          setScanProgress({
            state: typeof json.state === "string" ? json.state : "running",
            libraryName: currentLibraryName,
            libraryOrdinal: currentLibraryOrdinal,
            libraryTotal: totalLibraries,
            aggregateItemsFetched: aggregateItemsCompleted + currentLibraryItemsFetched,
            currentIndex: Number(p.currentIndex ?? 0),
            targetCount: Number(p.targetCount ?? 0),
            endpointTargetCount: Number(p.endpointTargetCount ?? 0),
            itemsFetched: Number(p.itemsFetched ?? 0),
            totalItemsHint: Number(p.totalItemsHint ?? 0),
            fetchedPages: Number(p.fetchedPages ?? 0),
            endpointItemCounts:
              p.endpointItemCounts && typeof p.endpointItemCounts === "object" && !Array.isArray(p.endpointItemCounts)
                ? (p.endpointItemCounts as Record<string, number>)
                : {},
            scanPhase: typeof p.phase === "string" ? p.phase : undefined,
            contentEnrichQueued: typeof p.contentEnrichQueued === "number" ? p.contentEnrichQueued : undefined,
            contentEnrichDone: typeof p.contentEnrichDone === "number" ? p.contentEnrichDone : undefined
          });
        }
      };

      /** Lets React paint between chunk requests so the progress bar updates. */
      const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

      for (const [libraryIdx, libraryName] of selectedNames.entries()) {
        currentLibraryOrdinal = libraryIdx + 1;
        currentLibraryName = libraryName;
        currentLibraryItemsFetched = 0;
        const ensured = await ensureLibrary(libraryName);
        if (!ensured.ok) {
          warnings.push(`${libraryName}: ${ensured.message}`);
          runs.push({
            library: libraryName,
            ok: false,
            error: ensured.message
          });
          continue;
        }
        const library = ensured.library;

        setScanProgress({
          state: "running",
          libraryName,
          libraryOrdinal: currentLibraryOrdinal,
          libraryTotal: totalLibraries,
          aggregateItemsFetched: aggregateItemsCompleted,
          currentIndex: 0,
          targetCount: 0,
          endpointTargetCount: 0,
          itemsFetched: 0,
          totalItemsHint: 0,
          fetchedPages: 0,
          endpointItemCounts: {},
          scanPhase: undefined,
          contentEnrichQueued: undefined,
          contentEnrichDone: undefined
        });
        await yieldToUi();

        const startRes = await fetch("/api/scan/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            libraryId: library.id,
            chunkSize: scanChunkSize,
            runToCompletion: false,
            maxChunks
          })
        });
        let latest = (await parseApiResponse(startRes)) as {
          ok?: boolean;
          jobId?: unknown;
          state?: string;
          progress?: {
            currentIndex?: number;
            targetCount?: number;
            endpointTargetCount?: number;
            itemsFetched?: number;
            totalItemsHint?: number;
            fetchedPages?: number;
            endpointItemCounts?: Record<string, number>;
          };
          error?: string;
          details?: string;
          stats?: unknown;
        };
        let jobId = toJobId(latest?.jobId);

        if (jobId) setScanJobId(jobId);
        applyScanProgress(latest);

        if (!jobId) {
          const err =
            typeof latest?.error === "string"
              ? latest.error
              : typeof latest?.details === "string"
                ? latest.details
                : "scan/start did not return a jobId";
          warnings.push(`${libraryName}: ${err}`);
          runs.push({ library: libraryName, response: latest });
          continue;
        }

        const maxContinues = Math.max(0, maxChunks - 1);
        let continueCount = 0;
        while (String(latest?.state || "").toLowerCase() !== "completed" && continueCount < maxContinues) {
          await yieldToUi();
          const contRes = await fetch("/api/scan/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, chunkSize: scanChunkSize })
          });
          latest = (await parseApiResponse(contRes)) as typeof latest;
          continueCount += 1;

          if (latest?.ok === false) {
            const err =
              typeof latest?.error === "string"
                ? latest.error
                : typeof latest?.details === "string"
                  ? latest.details
                  : "scan/continue failed";
            warnings.push(`${libraryName}: ${err}`);
            break;
          }
          applyScanProgress(latest);
        }

        if (String(latest?.state || "").toLowerCase() !== "completed" && continueCount >= maxContinues) {
          const prog = latest?.progress as { phase?: string } | undefined;
          const phase = typeof prog?.phase === "string" ? prog.phase : "unknown";
          warnings.push(
            `${libraryName}: Scan stopped after ${maxChunks} API steps (last phase: ${phase}). The job may still be running; content reference mining runs in enrich_content after crawl, folders, and templates. Re-run Analyze or increase limits.`
          );
        } else if (String(latest?.state || "").toLowerCase() !== "completed") {
          const prog = latest?.progress as { phase?: string } | undefined;
          const phase = typeof prog?.phase === "string" ? prog.phase : "unknown";
          warnings.push(
            `${libraryName}: Scan did not finish (phase: ${phase}). Analytics and REFERENCES counts may be incomplete.`
          );
        }

        const analytics = await loadLibraryAnalytics(library.id, library.name, jobId, deadWoodLimit);
        nextAnalytics[library.name] = analytics;
        aggregateItemsCompleted += currentLibraryItemsFetched;
        runs.push(
          lowMemoryMode
            ? {
                library: libraryName,
                state: latest?.state,
                ok: latest?.ok,
                progress: latest?.progress,
                stats: latest?.stats
              }
            : { library: libraryName, response: latest }
        );
      }
      setAnalyticsByLibrary((prev) => ({ ...prev, ...nextAnalytics }));
      const nextKeys = Object.keys(nextAnalytics);
      if (nextKeys.length > 0 && !selectedAnalyticsLibrary) {
        setSelectedAnalyticsLibrary(nextKeys[0]);
      }
      setResult(
        safeStringify({
          ok: true,
          mode: "scan",
          lowMemoryMode,
          selectedLibraries: selectedNames,
          runs
        })
      );

      let banner = warnings.length > 0 ? warnings.join(" ") : "";
      if (nextKeys.length === 0 && selectedDiscoveredLibraries.length > 0 && !banner) {
        banner =
          "Analyze did not produce any scan jobs. Expand Response below for API errors (often DATABASE_URL or database schema).";
      }
      if (nextKeys.length > 0) {
        const inv = nextAnalytics[nextKeys[0]!]!.inventory;
        const sum =
          inv.pt_count +
          inv.at_count +
          inv.sitearea_count +
          inv.content_count +
          inv.component_count +
          inv.library_count +
          inv.folder_count;
        if (sum === 0) {
          banner =
            (banner ? `${banner} ` : "") +
            "Inventory is still empty. If your database predates WCM Library rows, run db/migrations/001_add_library_element_type.sql on Neon, then Analyze again.";
        }
      }
      setAnalyzeBanner(banner);
    } catch (error) {
      setAnalyzeBanner(error instanceof Error ? error.message : String(error));
      setResult(
        safeStringify({
          ok: false,
          error: "Scan call failed",
          details: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      setBusy("none");
    }
  };

  useEffect(() => {
    const savedBaseUrl = window.localStorage.getItem(STORAGE_KEYS.baseUrl);
    const savedPath = window.localStorage.getItem(STORAGE_KEYS.contenthandlerPath);
    if (savedBaseUrl) setBaseUrl(savedBaseUrl);
    if (savedPath) setContenthandlerPath(savedPath);
  }, []);

  useEffect(() => {
    if (skipPersistBaseUrl.current) {
      skipPersistBaseUrl.current = false;
      return;
    }
    if (baseUrl.trim()) {
      window.localStorage.setItem(STORAGE_KEYS.baseUrl, baseUrl.trim());
    }
  }, [baseUrl]);

  useEffect(() => {
    if (skipPersistContenthandlerPath.current) {
      skipPersistContenthandlerPath.current = false;
      return;
    }
    if (contenthandlerPath.trim()) {
      window.localStorage.setItem(STORAGE_KEYS.contenthandlerPath, contenthandlerPath.trim());
    }
  }, [contenthandlerPath]);

  useEffect(() => {
    setContenthandlerPath((current) => {
      const normalized = current.trim();
      if (authMode === "session") {
        if (!normalized || normalized === BASIC_DEFAULT_CONTENTHANDLER_PATH) {
          return SESSION_DEFAULT_CONTENTHANDLER_PATH;
        }
      }
      return current;
    });
  }, [authMode]);

  useEffect(() => {
    const local = loadLocalLibraries();
    setLibraries(local);
  }, []);

  useEffect(() => {
    void refreshGraphHealth();
  }, []);

  const analyticsKeys = Object.keys(analyticsByLibrary);
  const activeAnalytics =
    (selectedAnalyticsLibrary && analyticsByLibrary[selectedAnalyticsLibrary]) ||
    (analyticsKeys.length > 0 ? analyticsByLibrary[analyticsKeys[0]] : null);
  const inventoryChartData = activeAnalytics
    ? [
        { name: "PT", value: activeAnalytics.inventory.pt_count },
        { name: "AT", value: activeAnalytics.inventory.at_count },
        { name: "SiteArea", value: activeAnalytics.inventory.sitearea_count },
        { name: "Content", value: activeAnalytics.inventory.content_count },
        { name: "Component", value: activeAnalytics.inventory.component_count },
        { name: "Library", value: activeAnalytics.inventory.library_count },
        { name: "Folder", value: activeAnalytics.inventory.folder_count }
      ]
    : [];
  const summaryCards = [
    { title: "Libraries", value: String(analyticsKeys.length || selectedDiscoveredLibraries.length || 0), icon: Database },
    {
      title: "Elements Indexed",
      value: activeAnalytics
        ? String(
            activeAnalytics.inventory.component_count +
              activeAnalytics.inventory.content_count +
              activeAnalytics.inventory.sitearea_count +
              activeAnalytics.inventory.pt_count +
              activeAnalytics.inventory.at_count +
              activeAnalytics.inventory.library_count +
              activeAnalytics.inventory.folder_count
          )
        : "0",
      icon: Activity
    },
    { title: "Relationships", value: String(activeAnalytics?.linksCount || 0), icon: Network },
    {
      title: "Operational Friction",
      value: activeAnalytics ? String(activeAnalytics.deadWoodCount) : "N/A",
      icon: ShieldCheck
    }
  ];

  const hasConnection = Boolean(baseUrl.trim());
  const hasDiscoveredLibraries = discoveredLibraries.length > 0;
  const hasSelectedLibraries = selectedDiscoveredLibraries.length > 0;
  const discoveredSearchNormalized = discoveredSearch.trim().toLowerCase();
  const filteredDiscoveredLibraries = discoveredLibraries.filter((name) => {
    const matchesSearch = !discoveredSearchNormalized || name.toLowerCase().includes(discoveredSearchNormalized);
    const matchesSelection = !showSelectedOnly || selectedDiscoveredLibraries.includes(name);
    return matchesSearch && matchesSelection;
  });
  const hasAnalyzedData = analyticsKeys.length > 0;
  const hasDrillDownData = Boolean(activeAnalytics);
  const endpointBreakdown =
    scanProgress?.endpointItemCounts && typeof scanProgress.endpointItemCounts === "object"
      ? Object.entries(scanProgress.endpointItemCounts)
          .filter(([path]) => !/\/libraries$/i.test(path))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
      : [];
  const preferredEndpointOrder = [
    "/contents",
    "/contents/analysis",
    "/site-areas",
    "/authoring-templates",
    "/presentation-templates"
  ];
  const preferredEndpointRows = preferredEndpointOrder
    .map((path) => [path, scanProgress?.endpointItemCounts?.[path] ?? 0] as const)
    .filter(([, count]) => count > 0);
  const progressDenominator =
    scanProgress && scanProgress.endpointTargetCount > 0
      ? scanProgress.endpointTargetCount
      : scanProgress?.targetCount || 0;
  const progressNumerator = scanProgress ? Math.min(scanProgress.currentIndex, progressDenominator) : 0;
  const progressPercent =
    scanProgress?.state === "completed"
      ? 100
      : progressDenominator > 0
        ? Math.min(99, Math.max(0, Math.round((progressNumerator / progressDenominator) * 100)))
        : 0;
  const renderedEdges = showUnusedOnly
    ? graphSubgraph.edges.filter((e) => {
        const to = graphSubgraph.nodes.find((n) => n.id === e.toId);
        return Boolean(to?.isUnused);
      })
    : graphSubgraph.edges;
  const edgeTypeCounts = renderedEdges.reduce(
    (acc, e) => {
      const t = (e.type || "").toUpperCase();
      if (t === "REFERENCES") acc.references += 1;
      else if (t === "HAS_CHILD") acc.hasChild += 1;
      else acc.other += 1;
      return acc;
    },
    { references: 0, hasChild: 0, other: 0 }
  );
  const semanticEdgePercent =
    renderedEdges.length > 0 ? Math.round((edgeTypeCounts.references / renderedEdges.length) * 100) : 0;
  const ptNodes = graphSubgraph.nodes.filter((n) => n.type === "PT");
  const disconnectedPtCount = ptNodes.filter((n) => {
    const hasOut = renderedEdges.some((e) => e.fromId === n.id);
    return !hasOut;
  }).length;
  const referencesByTargetId = new Map<number, number>();
  for (const e of renderedEdges) {
    if ((e.type || "").toUpperCase() !== "REFERENCES") continue;
    referencesByTargetId.set(e.toId, (referencesByTargetId.get(e.toId) || 0) + 1);
  }
  const mostReferencedComponent = graphSubgraph.nodes
    .filter((n) => n.type === "Component")
    .map((n) => ({ node: n, refs: referencesByTargetId.get(n.id) || 0 }))
    .sort((a, b) => b.refs - a.refs)[0];
  const renderedHierarchy = showUnusedOnly
    ? graphSubgraph.hierarchy
        .map((h) => ({
          ...h,
          children: h.children.filter((c) => graphSubgraph.nodes.find((n) => n.id === c.id)?.isUnused)
        }))
        .filter((h) => h.children.length > 0)
    : graphSubgraph.hierarchy;
  const topReusedComponents = [...graphSubgraph.nodes]
    .filter((n) => n.type === "Component" && n.inbound > 0)
    .sort((a, b) => b.inbound - a.inbound)
    .slice(0, 8);
  const catalogComponents = [...graphSubgraph.nodes]
    .filter((n) => n.type === "Component")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const positionedNodes = buildGraphLayout(showUnusedOnly ? graphSubgraph.nodes.filter((n) => n.isUnused) : graphSubgraph.nodes);
  const posById = new Map<number, PositionedNode>(positionedNodes.map((n) => [n.id, n]));
  const graphWidth = Math.max(960, ...positionedNodes.map((n) => n.x + 120));
  const graphHeight = Math.max(320, ...positionedNodes.map((n) => n.y + 80));
  const selectedNode = selectedGraphNodeId ? graphSubgraph.nodes.find((n) => n.id === selectedGraphNodeId) || null : null;
  const selectedNeighborIds = new Set<number>();
  if (selectedGraphNodeId) {
    for (const e of renderedEdges) {
      if (e.fromId === selectedGraphNodeId) selectedNeighborIds.add(e.toId);
      if (e.toId === selectedGraphNodeId) selectedNeighborIds.add(e.fromId);
    }
  }

  useEffect(() => {
    if (!activeAnalytics?.libraryId) return;
    if (graphSubgraph.libraryId === activeAnalytics.libraryId && graphSubgraph.nodes.length > 0) return;
    void loadGraphSubgraph(activeAnalytics.libraryId);
  }, [activeAnalytics?.libraryId]);

  const flowSteps = [
    { label: "1) Connect", done: hasConnection },
    { label: "2) Discover", done: hasDiscoveredLibraries },
    { label: "3) Select", done: hasSelectedLibraries },
    { label: "4) Analyze", done: hasAnalyzedData },
    { label: "5) Report", done: hasDrillDownData }
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(1200px_600px_at_10%_-10%,#e9efff_0%,#f6f9fc_40%,#f6f9fc_100%)] text-[#0a2540]">
      <section className="mx-auto max-w-7xl px-6 py-14">
        <header className="stripe-hero mb-12 px-8 py-12">
          <div className="relative z-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[#0a2540]">DX.IQ</h1>
          <p className="mt-2 text-sm text-[#425466]">
            HCL DX WCM deep-scan inventory and relationship mapper.
          </p>
                  </div>
        </header>

        <div className="stripe-card overflow-x-auto">
          <div className="flex min-w-[720px] divide-x divide-[#e6ebf1]">
            {summaryCards.map(({ title, value, icon: Icon }) => (
              <article key={title} className="flex-1 px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#425466]">{title}</p>
                  <Icon className="h-3.5 w-3.5 text-accent" />
                </div>
                <p className="mt-1 text-xl font-semibold leading-tight">{value}</p>
              </article>
            ))}
          </div>
        </div>

        <section className="stripe-card stripe-section p-8">
          <h2 className="text-lg font-medium">Analysis Flow</h2>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setShowTechnicalView((v) => !v)}
              className="stripe-button stripe-button-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showTechnicalView ? "Technical view on" : "Technical view off"}
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <ol className="flex min-w-[860px] gap-2 text-xs">
              {flowSteps.map((step) => (
                <li
                  key={step.label}
                  className={`flex-1 rounded-lg border px-3 py-2 transition-all ${
                    step.done
                      ? "border-[#635BFF] bg-[#635BFF] text-white shadow-[0_4px_10px_rgba(99,91,255,0.28)]"
                      : "border-[#e6ebf1] bg-white text-[#425466]"
                  }`}
                >
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="stripe-card stripe-section p-8">
          <h2 className="text-lg font-medium">Library Connectivity Validation</h2>
          <p className="mt-1 text-sm text-[#425466]">
            Test base endpoint reachability and probe common DX Contenthandler routes.
          </p>
          {isLocalViteDev && showTechnicalView ? (
            <p className="mt-2 rounded-lg border border-[#c7d2e5] bg-[#f6f9fc] px-3 py-2 text-xs text-[#425466]">
              Local dev: the UI forwards <code className="text-[#0a2540]">/api</code> to{" "}
              <code className="text-[#0a2540]">http://localhost:8787</code>. If connection tests fail immediately, start the
              API with <code className="text-[#0a2540]">npm run dev:api</code> or run <code className="text-[#0a2540]">npm run dev:all</code>{" "}
              for API + UI.
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[#425466]">Base URL</span>
              <input
                className="stripe-input text-sm"
                placeholder="https://your-dx-host.example.com/..."
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[#425466]">Authentication Mode</span>
              <select
                className="stripe-input text-sm"
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value as "basic" | "session")}
              >
                <option value="basic">Basic Auth (username/password)</option>
                <option value="session">Session Cookie</option>
              </select>
            </label>
            {authMode === "basic" ? (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-[#425466]">Username</span>
                  <input
                    className="stripe-input text-sm"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[#425466]">Password</span>
                  <input
                    type="password"
                    className="stripe-input text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-[#425466]">Username</span>
                  <input
                    className="stripe-input text-sm"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[#425466]">Password</span>
                  <input
                    type="password"
                    className="stripe-input text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <span className="mb-1 block text-[#425466]">Session Cookie (optional fallback)</span>
                  <textarea
                    className="stripe-input text-xs"
                    rows={3}
                    placeholder="Paste Cookie header (e.g. LTPAToken2=...; JSESSIONID=...)"
                    value={sessionCookieInput}
                    onChange={(e) => setSessionCookieInput(e.target.value)}
                  />
                </label>
                <div className="text-sm md:col-span-2">
                  <span className="mb-1 block text-[#425466]">Generated Session</span>
                  <div className="rounded-lg border border-[#e6ebf1] bg-white px-3 py-2 text-xs text-[#425466]">
                    {sessionToken ? "Session established and ready." : "No session token yet."}
                  </div>
                </div>
              </>
            )}
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[#425466]">Contenthandler path (optional)</span>
              <input
                className="stripe-input text-sm"
                value={contenthandlerPath}
                onChange={(e) => setContenthandlerPath(e.target.value)}
              />
            </label>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              {authMode === "session" ? (
                <button
                  type="button"
                  onClick={generateSessionFromLogin}
                  disabled={
                    sessionBootstrapping || !baseUrl || ((!username || !password) && !sessionCookieInput.trim())
                  }
                  className="stripe-button stripe-button-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {sessionBootstrapping ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Generate Session
                </button>
              ) : null}
              <button
                type="button"
                onClick={discoverLibraries}
                disabled={
                  discovering || !baseUrl || (authMode === "session" && ((!username || !password) && !sessionCookieInput.trim()))
                }
                className="stripe-button stripe-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Discover Libraries
              </button>
              <button
                type="button"
                onClick={runProbe}
                disabled={busy !== "none"}
                className="stripe-button stripe-button-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {busy === "connection" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Test Connection
              </button>
            </div>
          </div>

          <div className="stripe-card mt-6 p-4">
            <p className="text-xs uppercase tracking-wide text-[#425466]">Discovered Libraries</p>
            {discoveredLibraries.length === 0 ? (
              <div className="mt-2 space-y-2 text-sm text-[#425466]">
                <p>No discovered libraries yet.</p>
                {discoveryIssue ? (
                  <div className="rounded-lg border border-[#f0d087] bg-[#fff8ea] p-3 text-[#6b4f00]">
                    {discoveryIssue}
                  </div>
                ) : null}
                {discoveryAttempts.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowDiscoveryDiagnostics((v) => !v)}
                      className="stripe-button stripe-button-secondary inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium"
                    >
                      {showDiscoveryDiagnostics ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Probe diagnostics
                    </button>
                    {showDiscoveryDiagnostics ? (
                  <ul className="max-h-36 space-y-1 overflow-auto text-xs">
                    {discoveryAttempts.map((a) => (
                      <li key={`${a.path}-${a.status}`} className="rounded-lg border border-[#e6ebf1] bg-white px-2 py-1">
                        {a.path} - {a.status} - {a.contentType}
                        {a.portalHtmlFallback ? " - portal HTML fallback" : ""}
                      </li>
                    ))}
                  </ul>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="stripe-input max-w-sm text-sm"
                    placeholder="Search libraries..."
                    value={discoveredSearch}
                    onChange={(e) => setDiscoveredSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSelectedOnly((v) => !v)}
                    className="stripe-button stripe-button-secondary px-3 py-1.5 text-xs font-medium"
                  >
                    {showSelectedOnly ? "Show all" : "Show selected only"}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectVisibleDiscoveredLibraries(filteredDiscoveredLibraries)}
                    className="stripe-button stripe-button-secondary px-3 py-1.5 text-xs font-medium"
                  >
                    Select visible
                  </button>
                  <button
                    type="button"
                    onClick={() => clearVisibleDiscoveredLibraries(filteredDiscoveredLibraries)}
                    className="stripe-button stripe-button-secondary px-3 py-1.5 text-xs font-medium"
                  >
                    Clear visible
                  </button>
                  <span className="text-xs text-[#425466]">
                    {selectedDiscoveredLibraries.length} selected • {filteredDiscoveredLibraries.length}/{discoveredLibraries.length} shown
                  </span>
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border border-[#e6ebf1] bg-[#fbfdff] p-2">
                  <div className="grid gap-1 md:grid-cols-2">
                  {filteredDiscoveredLibraries.map((item) => (
                    <label key={item} className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-[#d8dee9] hover:bg-white">
                      <input
                        type="checkbox"
                        name="discovered-library"
                        value={item}
                        checked={selectedDiscoveredLibraries.includes(item)}
                        onChange={() => {
                          toggleDiscoveredLibrary(item);
                        }}
                        className="accent-[#635bff]"
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                  </div>
                  {filteredDiscoveredLibraries.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-[#6b7c93]">No libraries match the current filter.</p>
                  ) : null}
                </div>
                <p className="text-xs text-[#425466]">
                  Select one or more libraries to include in the scan.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                graphHealth.status === "healthy"
                  ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
                  : graphHealth.status === "disabled"
                    ? "border-[#fde68a] bg-[#fffbeb] text-[#92400e]"
                    : graphHealth.status === "error"
                      ? "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
                      : "border-[#e6ebf1] bg-white text-[#425466]"
              }`}
            >
              Graph ingest:{" "}
              {graphHealth.loading
                ? "checking..."
                : graphHealth.status === "healthy"
                  ? "enabled"
                  : graphHealth.status === "disabled"
                    ? "disabled"
                    : graphHealth.status === "error"
                      ? "error"
                      : "unknown"}
            </span>
            <button
              type="button"
              onClick={refreshGraphHealth}
              disabled={graphHealth.loading}
              className="stripe-button stripe-button-secondary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {graphHealth.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Refresh Graph Status
            </button>
            <button
              type="button"
              onClick={runScan}
              disabled={busy !== "none" || selectedDiscoveredLibraries.length === 0}
              className="stripe-button stripe-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Analyze
            </button>
            <p className="self-center text-xs text-[#425466]">
              Active job: {scanJobId ?? "none"} (selected libraries: {selectedDiscoveredLibraries.length})
            </p>
          </div>
          <p className="mt-2 text-xs text-[#425466]">
            {lowMemoryMode
              ? "Low-memory mode is on: smaller scan chunks, all selected libraries scanned sequentially in one Analyze run, reduced dead-wood drill-down, and compact scan responses."
              : "Low-memory mode is off: faster scans with larger response payloads."}
          </p>
          <p className="mt-1 text-xs text-[#425466]">{graphHealth.message}</p>
          {analyzeBanner ? (
            <div className="mt-2 rounded-lg border border-[#f0d087] bg-[#fff8ea] p-3 text-sm text-[#6b4f00]">
              {analyzeBanner}
            </div>
          ) : null}

          <div className="stripe-card mt-4 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-[#425466]">
              <span>
                Scan Progress{" "}
                {scanProgress
                  ? `(${scanProgress.state})`
                  : "(idle)"}
              </span>
              <span>
                {scanProgress
                  ? `library ${scanProgress.libraryOrdinal}/${scanProgress.libraryTotal}: ${scanProgress.libraryName || "n/a"} • items ${scanProgress.itemsFetched}/${scanProgress.totalItemsHint || "?"} • endpoints ${scanProgress.currentIndex}/${scanProgress.endpointTargetCount || scanProgress.targetCount || 0} • aggregate items ${scanProgress.aggregateItemsFetched} • fetched ${scanProgress.fetchedPages} • phase ${scanProgress.scanPhase || "—"}${
                      scanProgress.scanPhase === "enrich_content" &&
                      typeof scanProgress.contentEnrichQueued === "number"
                        ? ` • content enrich ${scanProgress.contentEnrichDone ?? 0}/${scanProgress.contentEnrichQueued}`
                        : ""
                    }`
                  : "0/0"}
              </span>
            </div>
            <div className="h-2 w-full rounded bg-[#d8e0ee]">
              <div
                className="h-2 rounded bg-accent transition-all"
                style={{
                  width: `${progressPercent}%`
                }}
              />
            </div>
            {endpointBreakdown.length > 0 ? (
              <div className="mt-2 text-xs text-[#425466]">
                {preferredEndpointRows.length > 0
                  ? `Core content rows: ${preferredEndpointRows.map(([path, count]) => `${path}=${count}`).join(" • ")}`
                  : `Top endpoint rows: ${endpointBreakdown.map(([path, count]) => `${path}=${count}`).join(" • ")}`}
              </div>
            ) : null}
          </div>

          <div className="stripe-card mt-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wide text-[#425466]">Relationship Explorer</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-[#425466]">
                  <input
                    type="checkbox"
                    checked={showUnusedOnly}
                    onChange={(e) => setShowUnusedOnly(e.target.checked)}
                    className="accent-[#635bff]"
                  />
                  Show unused components only
                </label>
                {activeAnalytics?.libraryId ? (
                  <button
                    type="button"
                    onClick={() => {
                      void loadGraphSubgraph(activeAnalytics.libraryId);
                    }}
                    disabled={graphSubgraph.loading}
                    className="stripe-button stripe-button-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                  >
                    {graphSubgraph.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Refresh
                  </button>
                ) : null}
              </div>
            </div>
            {graphSubgraph.error ? (
              <div className="mt-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-3 text-xs text-[#991b1b]">
                {graphSubgraph.error}
              </div>
            ) : null}
            {graphSubgraph.story ? (
              <div className="mt-2 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-3 text-sm text-[#1e3a5f]">
                <p className="font-medium">{graphSubgraph.story.headline}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#334155]">{graphSubgraph.story.detail}</p>
                <p className="mt-2 text-xs text-[#64748b]">
                  In this snapshot: {graphSubgraph.story.ptCount} PT nodes, {graphSubgraph.story.componentCount}{" "}
                  component nodes.
                </p>
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="stripe-card p-3">
                <p className="text-xs text-[#425466]">Nodes</p>
                <p className="mt-1 text-lg font-semibold">{graphSubgraph.summary.nodes}</p>
              </div>
              <div className="stripe-card p-3">
                <p className="text-xs text-[#425466]">Edges</p>
                <p className="mt-1 text-lg font-semibold">{graphSubgraph.summary.edges}</p>
              </div>
              <div className="stripe-card p-3">
                <p className="text-xs text-[#425466]">Unused Components</p>
                <p className="mt-1 text-lg font-semibold">{graphSubgraph.summary.unusedComponents}</p>
              </div>
              <div className="stripe-card p-3">
                <p className="text-xs text-[#425466]">Data Window</p>
                <p className="mt-1 text-sm font-semibold">{graphSubgraph.summary.truncated ? "Truncated" : "Full"}</p>
              </div>
            </div>
            <div className="stripe-card mt-4 p-3">
              <p className="text-xs uppercase tracking-wide text-[#425466]">Graph Insights</p>
              <p className="mt-1 text-xs text-[#425466]">
                Link mix: REFERENCES {edgeTypeCounts.references} • HAS_CHILD {edgeTypeCounts.hasChild}
                {edgeTypeCounts.other > 0 ? ` • OTHER ${edgeTypeCounts.other}` : ""} • semantic confidence{" "}
                {semanticEdgePercent}%
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#0a2540]">
                <li>
                  {semanticEdgePercent < 30
                    ? "Action: prioritize template enrichment (PT detail + references endpoints) because most links are structural."
                    : "Action: semantic template/component relationships are present; focus cleanup on high-fanout components and disconnected templates."}
                </li>
                <li>
                  {disconnectedPtCount > 0
                    ? `Action: review ${disconnectedPtCount} presentation templates with no outgoing links; these are likely missing references or stale templates.`
                    : "Action: all discovered presentation templates have outgoing links in this view."}
                </li>
                <li>
                  {graphSubgraph.summary.unusedComponents > 0
                    ? `Action: inspect ${graphSubgraph.summary.unusedComponents} unused components first for archive/deletion candidates.`
                    : "Action: no unused components detected in this subgraph window."}
                </li>
                <li>
                  {mostReferencedComponent && mostReferencedComponent.refs > 0
                    ? `Action: validate impact of "${mostReferencedComponent.node.name}" first (${mostReferencedComponent.refs} REFERENCES).`
                    : "Action: no component reference hotspots detected yet; verify REFERENCES extraction quality."}
                </li>
              </ul>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="stripe-card p-3 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-[#425466]">Interactive Relationship Graph</p>
                  <div className="flex items-center gap-2 text-xs text-[#425466]">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min={60}
                      max={180}
                      value={Math.round(graphZoom * 100)}
                      onChange={(e) => setGraphZoom(Number(e.target.value) / 100)}
                    />
                  </div>
                </div>
                <div className="max-h-[420px] overflow-auto rounded border border-[#e6ebf1] bg-white">
                  <svg
                    width={graphWidth * graphZoom}
                    height={graphHeight * graphZoom}
                    viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                  >
                    {renderedEdges.map((e, idx) => {
                      const from = posById.get(e.fromId);
                      const to = posById.get(e.toId);
                      if (!from || !to) return null;
                      const isSelectedEdge =
                        selectedGraphNodeId !== null && (e.fromId === selectedGraphNodeId || e.toId === selectedGraphNodeId);
                      return (
                        <line
                          key={`${e.fromId}-${e.toId}-${idx}`}
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke={isSelectedEdge ? "#635BFF" : "#c7d2e5"}
                          strokeWidth={isSelectedEdge ? 2 : 1}
                        />
                      );
                    })}
                    {positionedNodes.map((n) => {
                      const selected = selectedGraphNodeId === n.id;
                      const neighbor = selectedNeighborIds.has(n.id);
                      const dim = selectedGraphNodeId !== null && !selected && !neighbor;
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${n.x}, ${n.y})`}
                          onClick={() => setSelectedGraphNodeId((prev) => (prev === n.id ? null : n.id))}
                          style={{ cursor: "pointer", opacity: dim ? 0.25 : 1 }}
                        >
                          <circle
                            r={n.isUnused ? 13 : 10}
                            fill={selected ? "#4338ca" : n.isUnused ? "#ef4444" : "#0ea5e9"}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                          <title>{n.name}</title>
                          <text x={14} y={4} fontSize={11} fill="#0a2540">
                            {n.name.length > 36 ? `${n.name.slice(0, 34)}…` : n.name}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <p className="mt-2 text-xs text-[#425466]">
                  Click a node to highlight direct neighbors. Red nodes are unused components.
                  {selectedNode ? ` Selected: ${selectedNode.name} (${selectedNode.type})` : ""}
                </p>
              </div>
              <div className="stripe-card p-3">
                <p className="text-xs uppercase tracking-wide text-[#425466]">Hierarchy (PT -&gt; Referenced Nodes)</p>
                <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm">
                  {renderedHierarchy.length === 0 ? (
                    <li className="text-[#425466]">No hierarchy relationships available for current filters.</li>
                  ) : (
                    renderedHierarchy.slice(0, 40).map((row) => (
                      <li key={row.ptId} className="rounded-lg border border-[#e6ebf1] bg-white p-2">
                        <p className="font-medium">{row.ptName}</p>
                        <p className="mt-1 text-xs text-[#425466]">
                          {row.children.slice(0, 8).map((c) => `${c.name} (${c.type})`).join(", ")}
                          {row.children.length > 8 ? ` +${row.children.length - 8} more` : ""}
                        </p>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="stripe-card p-3">
                <p className="text-xs uppercase tracking-wide text-[#425466]">Most Reused Components</p>
                <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-sm">
                  {topReusedComponents.length === 0 ? (
                    <li className="text-[#425466]">No component reuse detected yet.</li>
                  ) : (
                    topReusedComponents.map((n) => (
                      <li key={n.id} className="flex items-center justify-between rounded-lg border border-[#e6ebf1] bg-white px-2 py-1">
                        <span>{n.name}</span>
                        <span className="text-xs text-[#425466]">inbound {n.inbound}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
            {showTechnicalView ? (
            <div className="stripe-card mt-4 p-3">
              <p className="text-xs uppercase tracking-wide text-[#425466]">Component library inventory</p>
              <p className="mt-1 text-xs text-[#425466]">
                Names come from WCM REST fields, self links, and the catalog endpoint (menus, navigators, etc.). Re-scan after
                upgrades to refresh labels.
              </p>
              {catalogComponents.length === 0 ? (
                <p className="mt-2 text-sm text-[#425466]">No components in this subgraph yet. Run Analyze, then open Relationship Explorer.</p>
              ) : (
                <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
                  {catalogComponents.map((n) => (
                    <li
                      key={n.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-lg border border-[#e6ebf1] bg-white px-2 py-1"
                    >
                      <span className="font-medium text-[#0a2540]">{n.name}</span>
                      <span className="text-xs text-[#425466]">{n.wcmId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            ) : null}
            {showTechnicalView ? (
            <div className="stripe-card mt-4 p-3">
              <p className="text-xs uppercase tracking-wide text-[#425466]">Reference Links</p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-sm">
                {renderedEdges.length === 0 ? (
                  <li className="text-[#425466]">No links available for current filters.</li>
                ) : (
                  renderedEdges.slice(0, 160).map((e, idx) => (
                    <li key={`${e.fromId}-${e.toId}-${idx}`} className="rounded-lg border border-[#e6ebf1] bg-white px-2 py-1">
                      <span className="font-medium">{e.fromName}</span>
                      <span className="mx-1 text-xs text-[#425466]">[{e.fromType}]</span>
                      <span className="text-xs text-[#425466]">-&gt; {e.type} -&gt;</span>
                      <span className="ml-1 font-medium">{e.toName}</span>
                      <span className="ml-1 text-xs text-[#425466]">[{e.toType}]</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            ) : null}
          </div>

          <div className="stripe-card mt-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wide text-[#425466]">Detailed Analytics</p>
              {analyticsKeys.length > 0 ? (
                <select
                  className="stripe-input max-w-sm text-sm"
                  value={selectedAnalyticsLibrary || analyticsKeys[0]}
                  onChange={(e) => setSelectedAnalyticsLibrary(e.target.value)}
                >
                  {analyticsKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {!activeAnalytics ? (
              <p className="mt-3 text-sm text-[#425466]">Run Analyze to generate graphical reports and drill-down data.</p>
            ) : (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="stripe-card p-3">
                    <p className="text-xs text-[#425466]">Components</p>
                    <p className="mt-1 text-xl font-semibold">{activeAnalytics.inventory.component_count}</p>
                  </div>
                  <div className="stripe-card p-3">
                    <p className="text-xs text-[#425466]">Relationships</p>
                    <p className="mt-1 text-xl font-semibold">{activeAnalytics.linksCount}</p>
                    <p className="mt-1 text-xs leading-snug text-[#425466]">
                      REFERENCES from content: {activeAnalytics.referencesFromContentCount} · from PT:{" "}
                      {activeAnalytics.referencesFromPtCount}
                    </p>
                  </div>
                  <div className="stripe-card p-3">
                    <p className="text-xs text-[#425466]">Dead Wood</p>
                    <p className="mt-1 text-xl font-semibold">{activeAnalytics.deadWoodCount}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="stripe-card h-64 p-2">
                    <p className="px-2 pt-1 text-xs text-[#425466]">Inventory Mix</p>
                    <ResponsiveContainer width="100%" height="90%">
                      <PieChart>
                        <Pie data={inventoryChartData} dataKey="value" nameKey="name" outerRadius={80} label>
                          {inventoryChartData.map((_, i) => (
                            <Cell key={i} fill={["#635BFF", "#0A2540", "#00D4FF", "#6C7A89", "#8A8FFF", "#B4C4FF"][i % 6]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="stripe-card h-64 p-2">
                    <p className="px-2 pt-1 text-xs text-[#425466]">Counts by Type</p>
                    <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={inventoryChartData}>
                        <XAxis dataKey="name" stroke="#6b7c93" />
                        <YAxis stroke="#6b7c93" />
                        <Tooltip />
                        <Bar dataKey="value" fill="#635BFF" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="stripe-card mt-4 p-3">
                  <p className="text-xs uppercase tracking-wide text-[#425466]">Dead Wood Drill-down</p>
                  <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-sm">
                    {activeAnalytics.deadWoodItems.length === 0 ? (
                      <li className="text-[#425466]">No dead wood components found for this library.</li>
                    ) : (
                      activeAnalytics.deadWoodItems.slice(0, 200).map((item) => (
                        <li key={item.id} className="rounded-lg border border-[#e6ebf1] bg-white px-2 py-1">
                          {item.name} <span className="text-xs text-[#425466]">({item.wcm_id})</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowResponsePayload((v) => !v)}
              className="stripe-button stripe-button-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium"
            >
              {showResponsePayload ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Response payload
            </button>
            {showResponsePayload ? (
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-[#d8dee9] bg-white p-3 text-xs text-[#0a2540]">
                {result || '{ "info": "Run a probe to view diagnostics." }'}
              </pre>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
