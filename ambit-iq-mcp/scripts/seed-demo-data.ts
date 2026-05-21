import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COUNTS = {
  interactions: 5000,
  modelUsage: 5000,
  decisionLogs: 4000,
  incidents: 50,
  incidentEvents: 300,
  metricSnapshots: 450,
} as const;

const BATCH_SIZE = 250;

const TENANTS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "acme-finance",
    name: "Acme Finance",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "globex-health",
    name: "Globex Health",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "northwind-retail",
    name: "Northwind Retail",
  },
] as const;

type InteractionType =
  | "generate_new_feature"
  | "refactor_existing_code"
  | "fix_bug"
  | "write_tests"
  | "explain_code"
  | "generate_migration"
  | "security_review"
  | "dependency_update"
  | "ui_component_generation"
  | "ci_pipeline_fix";

type CodingPhase = "plan" | "generate" | "review" | "fix" | "test" | "ship";

const INTERACTION_TYPES: readonly InteractionType[] = [
  "generate_new_feature",
  "refactor_existing_code",
  "fix_bug",
  "write_tests",
  "explain_code",
  "generate_migration",
  "security_review",
  "dependency_update",
  "ui_component_generation",
  "ci_pipeline_fix",
];

const LANGUAGES = ["TypeScript", "JavaScript", "SQL", "Python"] as const;
const FRAMEWORKS = ["React", "Express", "Prisma", "Vite", "Node.js", "Vitest"] as const;
const RISK_THEMES = [
  "auth_boundary",
  "tenant_isolation",
  "data_exfiltration",
  "prompt_injection",
  "policy_drift",
  "dependency_supply_chain",
  "runtime_reliability",
  "secret_management",
] as const;

const PROMPTS = [
  "Add tenant-aware filtering to this Prisma query without changing the API response shape.",
  "Refactor this Express auth middleware so it validates JWT issuer, audience, and tenant_id.",
  "Generate React form validation for the payment retry configuration screen.",
  "Write Vitest coverage for the model governance risk scoring logic.",
  "Fix the Vercel serverless timeout in the dashboard metrics endpoint.",
  "Explain why this policy replay result drifted after the new rule pack update.",
  "Create a migration that backfills risk_tier for historical decisions and keeps reads online.",
  "Patch CI so governance integration tests only run on policy or handler changes.",
  "Refactor this monolithic route into testable service modules.",
  "Generate a Zod schema for incident escalation payloads and wire it to the handler.",
] as const;

const RESPONSES = [
  "I will update the Prisma where clause to include tenantId and preserve existing filters.",
  "I found the missing auth guard and added role checks before replay execution.",
  "The generated test covers high-risk external model usage with regulated data.",
  "I split the endpoint into middleware plus service helpers to reduce failure blast radius.",
  "I added a bounded query window and cursor pagination to keep response times stable.",
  "I traced drift to the rule precedence update and added an explicit precedence assertion.",
  "I added schema validation and normalized default values to prevent null branch failures.",
  "I updated the workflow matrix and cache keys so CI retries are deterministic.",
] as const;

const CODE_SNIPPETS = [
  `// TypeScript\nconst withTenant = (tenantId: string, where: Prisma.AgentInteractionWhereInput) => ({\n  ...where,\n  tenantId,\n});`,
  `// React\nconst retrySchema = z.object({\n  retries: z.number().min(0).max(10),\n  cooldownSeconds: z.number().min(30),\n});`,
  `// Prisma\nawait prisma.agentInteraction.findMany({\n  where: { tenantId, createdAt: { gte: start, lt: end } },\n  orderBy: { createdAt: \"desc\" },\n});`,
  `// Express\nif (!claims?.tenant_id || claims.aud !== expectedAudience) {\n  return res.status(401).json({ error: \"invalid_claims\" });\n}`,
  `-- SQL\nUPDATE \"ambit_decision_logs\"\nSET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{risk_tier}', '"medium"'::jsonb)\nWHERE metadata->>'risk_tier' IS NULL;`,
  `# GitHub Actions\n- name: Governance Tests\n  if: contains(github.event.pull_request.changed_files, 'src/handlers')\n  run: npm run test -- dashboard.handlers`,
  `// Zod\nexport const IncidentEscalationSchema = z.object({\n  incidentId: z.string().uuid(),\n  severity: z.enum([\"low\", \"medium\", \"high\", \"critical\"]),\n});`,
] as const;

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    confirm: args.has("--confirm"),
    resetDemo: args.has("--reset-demo"),
  };
}

function uuidFrom(namespace: string, i: number): string {
  const nsHex = Buffer.from(namespace).toString("hex").slice(0, 8).padEnd(8, "0");
  const p1 = nsHex;
  const p2 = (i & 0xffff).toString(16).padStart(4, "0");
  const p3 = `4${((i >> 4) & 0x0fff).toString(16).padStart(3, "0")}`;
  const p4 = `8${((i >> 8) & 0x0fff).toString(16).padStart(3, "0")}`;
  const p5 = ((i * 7919 + namespace.length * 104729) >>> 0)
    .toString(16)
    .padStart(8, "0")
    .repeat(2)
    .slice(0, 12);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

function pick<T>(arr: readonly T[], index: number): T {
  return arr[index % arr.length];
}

function acceptanceFor(type: InteractionType, index: number): boolean {
  const ratioByType: Record<InteractionType, number> = {
    explain_code: 0.9,
    write_tests: 0.85,
    generate_new_feature: 0.62,
    security_review: 0.42,
    dependency_update: 0.58,
    generate_migration: 0.45,
    refactor_existing_code: 0.67,
    fix_bug: 0.73,
    ui_component_generation: 0.64,
    ci_pipeline_fix: 0.61,
  };
  const threshold = Math.floor(ratioByType[type] * 100);
  return (index * 17) % 100 < threshold;
}

function phaseForStep(step: number): CodingPhase {
  const phases: CodingPhase[] = ["plan", "generate", "review", "fix", "test", "ship"];
  return phases[step % phases.length];
}

async function createManyInBatches<T>(
  rows: T[],
  runBatch: (chunk: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const result = await runBatch(chunk);
    inserted += result.count;
  }
  return inserted;
}

async function ensureTenants() {
  for (const tenant of TENANTS) {
    await prisma.tenant.upsert({
      where: { slug: tenant.slug },
      update: { name: tenant.name, status: "active" },
      create: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: "active" },
    });
  }
}

async function resetDemoData() {
  await prisma.$transaction([
    prisma.incidentEvent.deleteMany({ where: { payload: { path: ["demo"], equals: true } } }),
    prisma.incident.deleteMany({ where: { metadata: { path: ["demo"], equals: true } } }),
    prisma.modelUsage.deleteMany({ where: { metadata: { path: ["demo"], equals: true } } }),
    prisma.agentInteraction.deleteMany({ where: { metadata: { path: ["demo"], equals: true } } }),
    prisma.ambitDecisionLog.deleteMany({ where: { metadata: { path: ["demo"], equals: true } } }),
    prisma.dashboardMetricSnapshot.deleteMany({ where: { dimensions: { path: ["demo"], equals: true } } }),
  ]);
}

function buildDataset() {
  const interactions: Prisma.AgentInteractionCreateManyInput[] = [];
  const modelUsage: Prisma.ModelUsageCreateManyInput[] = [];
  const decisionLogs: Prisma.AmbitDecisionLogCreateManyInput[] = [];
  const incidents: Prisma.IncidentCreateManyInput[] = [];
  const incidentEvents: Prisma.IncidentEventCreateManyInput[] = [];
  const metricSnapshots: Prisma.DashboardMetricSnapshotCreateManyInput[] = [];

  const sessions = COUNTS.interactions / 5;
  const blockedSessionSet = new Set<number>();
  for (let i = 0; i < 80; i += 1) blockedSessionSet.add((i * 13) % sessions);

  const now = Date.now();
  const incidentIds: string[] = [];

  for (let i = 0; i < COUNTS.interactions; i += 1) {
    const tenant = pick(TENANTS, i);
    const sessionIndex = Math.floor(i / 5);
    const step = i % 5;
    const interactionType = pick(INTERACTION_TYPES, i + step);
    const vibeSessionId = `vibe-session-${sessionIndex.toString().padStart(4, "0")}`;
    const traceId = uuidFrom("trace", i + 1);
    const interactionId = uuidFrom("intr", i + 1);
    const language = pick(LANGUAGES, i + step);
    const framework = pick(FRAMEWORKS, i + step * 2);
    const riskTheme = pick(RISK_THEMES, i + step * 3);
    const accepted = acceptanceFor(interactionType, i);
    const blocked = blockedSessionSet.has(sessionIndex) && step >= 3;
    const createdAt = new Date(now - (COUNTS.interactions - i) * 6 * 60 * 1000);

    const prompt = `${pick(PROMPTS, i)} [session:${vibeSessionId} step:${step + 1}]`;
    const response = `${pick(RESPONSES, i)} (phase=${phaseForStep(step)})`;
    const proposedCode = pick(CODE_SNIPPETS, i);

    interactions.push({
      id: interactionId,
      traceId,
      decisionLogId: i < COUNTS.decisionLogs ? uuidFrom("dlog", i + 1) : null,
      sessionId: vibeSessionId,
      actorId: `developer-${(i % 27) + 1}`,
      teamId: `team-${(i % 8) + 1}`,
      agentName: "Project Vail Assistant",
      agentVersion: "v2.enterprise.seed",
      workspaceId: `workspace-${(i % 12) + 1}`,
      repo: "mckaystu/Ambit.IQ.MCP",
      branch: pick(["main", "feature/policy-hardening", "feature/vibe-data"], i),
      commitSha: `${(i + 1).toString(16).padStart(40, "0")}`,
      prNumber: `PR-${1000 + (i % 500)}`,
      promptCaptured: true,
      promptRedacted: prompt,
      promptHash: `prompt_hash_${i + 1}`,
      promptCharCount: prompt.length,
      responseCaptured: true,
      responseRedacted: response,
      responseHash: `response_hash_${i + 1}`,
      responseCharCount: response.length,
      proposedCodeRedacted: proposedCode,
      finalCodeRedacted: blocked ? null : `${proposedCode}\n// merged with reviewer adjustments`,
      codeHash: `code_hash_${i + 1}`,
      accepted: blocked ? false : accepted,
      capturePolicy: {
        demo: true,
        mode: "redacted",
        retention_days: 30,
      },
      metadata: {
        demo: true,
        interaction_type: interactionType,
        coding_phase: phaseForStep(step),
        user_intent: pick(PROMPTS, i),
        files_touched: [
          `src/handlers/${pick(["dashboard", "incident", "interaction"], i)}.handlers.ts`,
          `dashboard/src/${pick(["PolicyManager", "ReplayPage", "SignalIntelligencePage"], i)}.tsx`,
        ],
        language,
        framework,
        risk_theme: riskTheme,
        estimated_time_saved_minutes: 8 + (i % 53),
        human_review_required: interactionType === "security_review" || blocked,
        ai_confidence: Number((0.52 + ((i * 19) % 47) / 100).toFixed(2)),
        vibe_session_id: vibeSessionId,
      },
      tenantId: tenant.id,
      createdAt,
    });

    modelUsage.push({
      id: uuidFrom("muse", i + 1),
      traceId,
      decisionLogId: i < COUNTS.decisionLogs ? uuidFrom("dlog", i + 1) : null,
      interactionId,
      provider: pick(["openai", "anthropic", "google"], i),
      modelName: pick(["gpt-4.1", "claude-3.7-sonnet", "gemini-2.0-pro"], i),
      modelVersion: pick(["2026-03", "2026-02", "2026-01"], i),
      hostingType: pick(["saas", "private_endpoint"], i),
      endpointRegion: pick(["us-east-1", "eu-west-1", "ap-southeast-1"], i),
      dataProcessingRegion: pick(["us", "eu", "apac"], i),
      userGeography: pick(["US", "UK", "DE", "SG"], i),
      jurisdiction: pick(["US", "EU", "UK"], i),
      promptRetentionPolicy: pick(["30_days", "7_days", "none"], i),
      responseRetentionPolicy: pick(["30_days", "7_days", "none"], i + 1),
      trainingUsageAllowed: i % 3 !== 0,
      trainingExposureRisk: pick(["low", "medium", "high"], i),
      dataClassification: pick(["internal", "confidential", "regulated"], i),
      approvedForSensitiveCode: i % 4 !== 0,
      approvedForRegulatedWorkloads: i % 5 !== 0,
      modelPolicyVersion: `policy-${(i % 12) + 1}`,
      metadata: {
        demo: true,
        interaction_type: interactionType,
        coding_phase: phaseForStep(step),
        user_intent: pick(PROMPTS, i),
        files_touched: [`src/services/${pick(["audit", "alerting", "dashboard"], i)}.service.ts`],
        language,
        framework,
        risk_theme: riskTheme,
        estimated_time_saved_minutes: 5 + (i % 40),
        human_review_required: interactionType === "security_review",
        ai_confidence: Number((0.55 + ((i * 11) % 39) / 100).toFixed(2)),
        vibe_session_id: vibeSessionId,
      },
      tenantId: tenant.id,
      createdAt,
    });

    if (i < COUNTS.decisionLogs) {
      decisionLogs.push({
        id: uuidFrom("dlog", i + 1),
        traceId,
        timestamp: createdAt,
        actorId: `policy-engine-${(i % 6) + 1}`,
        intentPrompt: prompt,
        proposedCode,
        decision: blocked ? false : accepted,
        violations: blocked
          ? [
              {
                policy: "policy.security.tenant-boundary",
                severity: "high",
                message: "Generated patch removed tenant guard in privileged query",
              },
            ]
          : [],
        rawOpaPayload: {
          demo: true,
          rule_pack: `rules-${(i % 9) + 1}`,
          score: 40 + (i % 60),
        },
        metadata: {
          demo: true,
          interaction_type: interactionType,
          coding_phase: phaseForStep(step),
          user_intent: pick(PROMPTS, i),
          files_touched: [
            `src/services/${pick(["audit", "governance-standards", "dashboard"], i)}.service.ts`,
          ],
          language,
          framework,
          risk_theme: riskTheme,
          estimated_time_saved_minutes: 5 + (i % 45),
          human_review_required: interactionType === "security_review" || blocked,
          ai_confidence: Number((0.5 + ((i * 7) % 44) / 100).toFixed(2)),
          vibe_session_id: vibeSessionId,
        },
        tenantId: tenant.id,
      });
    }
  }

  for (let i = 0; i < COUNTS.incidents; i += 1) {
    const tenant = pick(TENANTS, i);
    const sessionIndex = (i * 19) % sessions;
    const vibeSessionId = `vibe-session-${sessionIndex.toString().padStart(4, "0")}`;
    const severity = pick(["low", "medium", "high", "critical"], i + 1);
    const incidentId = uuidFrom("inci", i + 1);
    incidentIds.push(incidentId);

    incidents.push({
      id: incidentId,
      title: `Vibe session policy violation escalation #${i + 1}`,
      description:
        "Policy enforcement detected potentially unsafe generated output requiring escalation and human approval.",
      severity,
      status: pick(["open", "triaged", "contained"], i),
      traceId: uuidFrom("trace", sessionIndex * 5 + 1),
      repo: "mckaystu/Ambit.IQ.MCP",
      actorId: `developer-${(i % 27) + 1}`,
      teamId: `team-${(i % 8) + 1}`,
      firstSeenAt: new Date(now - (COUNTS.incidents - i) * 3 * 60 * 60 * 1000),
      lastSeenAt: new Date(now - (COUNTS.incidents - i) * 90 * 60 * 1000),
      metadata: {
        demo: true,
        interaction_type: pick(INTERACTION_TYPES, i),
        coding_phase: "review",
        user_intent: pick(PROMPTS, i),
        files_touched: ["src/handlers/incident.handlers.ts"],
        language: pick(LANGUAGES, i),
        framework: pick(FRAMEWORKS, i),
        risk_theme: pick(RISK_THEMES, i),
        estimated_time_saved_minutes: 15 + (i % 55),
        human_review_required: true,
        ai_confidence: Number((0.45 + ((i * 5) % 35) / 100).toFixed(2)),
        vibe_session_id: vibeSessionId,
      },
      tenantId: tenant.id,
    });
  }

  for (let i = 0; i < COUNTS.incidentEvents; i += 1) {
    const incidentId = incidentIds[i % incidentIds.length];
    incidentEvents.push({
      id: uuidFrom("ievt", i + 1),
      incidentId,
      traceId: uuidFrom("trace", (i % COUNTS.interactions) + 1),
      timestamp: new Date(now - (COUNTS.incidentEvents - i) * 90 * 60 * 1000),
      eventType: pick(
        ["created", "triaged", "policy_recheck", "assigned", "resolved", "reopened"],
        i,
      ),
      actorId: pick(["svc.policy-engine", "user.analyst-1", "user.manager-2"], i),
      repo: "mckaystu/Ambit.IQ.MCP",
      commitSha: `${(i + 5000).toString(16).padStart(40, "0")}`,
      prNumber: `PR-${1200 + (i % 200)}`,
      payload: {
        demo: true,
        note: pick(
          [
            "Initial escalation from blocked vibe-coding session",
            "Analyst requested additional evidence from trace replay",
            "Policy re-check passed after secure patch",
          ],
          i,
        ),
        vibe_session_id: `vibe-session-${((i * 7) % sessions).toString().padStart(4, "0")}`,
      },
    });
  }

  const metricNames = [
    "interaction_acceptance_rate",
    "policy_block_rate",
    "incident_open_count",
    "avg_latency_ms",
    "daily_active_sessions",
  ] as const;

  for (let i = 0; i < COUNTS.metricSnapshots; i += 1) {
    const tenant = pick(TENANTS, i);
    const periodEnd = new Date(now - (COUNTS.metricSnapshots - i - 1) * 60 * 60 * 1000);
    const periodStart = new Date(periodEnd.getTime() - 60 * 60 * 1000);
    metricSnapshots.push({
      id: uuidFrom("metr", i + 1),
      metricName: pick(metricNames, i),
      dimensions: {
        demo: true,
        period: "hourly",
        source: "seed_v2",
        interaction_type: pick(INTERACTION_TYPES, i),
      },
      value: {
        demo: true,
        amount: Number((50 + ((i * 11) % 500) / 10).toFixed(2)),
        unit: "score",
      },
      tenantId: tenant.id,
      periodStart,
      periodEnd,
      createdAt: periodEnd,
    });
  }

  return { interactions, modelUsage, decisionLogs, incidents, incidentEvents, metricSnapshots };
}

async function main() {
  const { confirm, resetDemo } = parseArgs();

  if (!confirm) {
    console.error(
      "Refusing to seed without confirmation. Re-run with: npm run seed:demo -- --confirm [--reset-demo]",
    );
    process.exit(1);
  }

  await ensureTenants();

  if (resetDemo) {
    await resetDemoData();
    console.log("Removed existing demo=true rows before seeding.");
  }

  const { interactions, modelUsage, decisionLogs, incidents, incidentEvents, metricSnapshots } =
    buildDataset();

  const createdDecisionLogs = await createManyInBatches(decisionLogs, (chunk) =>
    prisma.ambitDecisionLog.createMany({ data: chunk, skipDuplicates: true }),
  );

  const createdInteractions = await createManyInBatches(interactions, (chunk) =>
    prisma.agentInteraction.createMany({ data: chunk, skipDuplicates: true }),
  );

  const createdModelUsage = await createManyInBatches(modelUsage, (chunk) =>
    prisma.modelUsage.createMany({ data: chunk, skipDuplicates: true }),
  );

  const createdIncidents = await createManyInBatches(incidents, (chunk) =>
    prisma.incident.createMany({ data: chunk, skipDuplicates: true }),
  );

  const createdIncidentEvents = await createManyInBatches(incidentEvents, (chunk) =>
    prisma.incidentEvent.createMany({ data: chunk, skipDuplicates: true }),
  );

  const createdMetricSnapshots = await createManyInBatches(metricSnapshots, (chunk) =>
    prisma.dashboardMetricSnapshot.createMany({ data: chunk, skipDuplicates: true }),
  );

  console.log("\nProject Vail demo seed v2 complete:");
  console.log(`- AgentInteraction created: ${createdInteractions} (target ${COUNTS.interactions})`);
  console.log(`- ModelUsage created: ${createdModelUsage} (target ${COUNTS.modelUsage})`);
  console.log(`- AmbitDecisionLog created: ${createdDecisionLogs} (target ${COUNTS.decisionLogs})`);
  console.log(`- Incident created: ${createdIncidents} (target ${COUNTS.incidents})`);
  console.log(`- IncidentEvent created: ${createdIncidentEvents} (target ${COUNTS.incidentEvents})`);
  console.log(
    `- DashboardMetricSnapshot created: ${createdMetricSnapshots} (target ${COUNTS.metricSnapshots})`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
