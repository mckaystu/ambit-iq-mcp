import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./audit.service.js";

export interface ModelMetadataInput {
  provider: string;
  modelName: string;
  modelVersion?: string | null;
  hostingType?: string | null;
  endpointRegion?: string | null;
  dataProcessingRegion?: string | null;
  userGeography?: string | null;
  jurisdiction?: string | null;
  promptRetentionPolicy?: string | null;
  responseRetentionPolicy?: string | null;
  trainingUsageAllowed?: boolean | null;
  trainingExposureRisk?: string | null;
  dataClassification?: string | null;
  approvedForSensitiveCode?: boolean | null;
  approvedForRegulatedWorkloads?: boolean | null;
  modelPolicyVersion?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ModelValidationContext {
  requiresSensitiveCode?: boolean;
  regulatedWorkload?: boolean;
  disallowedJurisdictions?: string[];
  dataClassification?: string | null;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ModelRiskAssessment {
  level: RiskLevel;
  rationale: string[];
}

export interface ModelGovernanceSummary {
  totalRecords: number;
  byRisk: Record<RiskLevel, number>;
  byProvider: Record<string, number>;
  byJurisdiction: Record<string, number>;
}

function clean(v: string | null | undefined): string | undefined {
  const out = String(v ?? "").trim();
  return out.length > 0 ? out : undefined;
}

function lower(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

export function normalizeModelMetadata(input: ModelMetadataInput): ModelMetadataInput {
  return {
    provider: String(input.provider || "").trim(),
    modelName: String(input.modelName || "").trim(),
    modelVersion: clean(input.modelVersion),
    hostingType: clean(input.hostingType),
    endpointRegion: clean(input.endpointRegion),
    dataProcessingRegion: clean(input.dataProcessingRegion),
    userGeography: clean(input.userGeography),
    jurisdiction: clean(input.jurisdiction),
    promptRetentionPolicy: clean(input.promptRetentionPolicy),
    responseRetentionPolicy: clean(input.responseRetentionPolicy),
    trainingUsageAllowed: input.trainingUsageAllowed ?? undefined,
    trainingExposureRisk: clean(input.trainingExposureRisk),
    dataClassification: clean(input.dataClassification),
    approvedForSensitiveCode: input.approvedForSensitiveCode ?? undefined,
    approvedForRegulatedWorkloads: input.approvedForRegulatedWorkloads ?? undefined,
    modelPolicyVersion: clean(input.modelPolicyVersion),
    metadata: input.metadata ?? {},
  };
}

export function assessModelRisk(metadataInput: ModelMetadataInput): ModelRiskAssessment {
  const metadata = normalizeModelMetadata(metadataInput);
  const reasons: string[] = [];
  let score = 0;

  const host = lower(metadata.hostingType);
  const isExternal = host.includes("external") || host.includes("saas") || host.includes("third");
  if (isExternal) {
    score += 4;
    reasons.push("External/SaaS hosting increases supply-chain and exposure risk.");
  }

  const classification = lower(metadata.dataClassification);
  const restrictedData =
    classification.includes("restricted") || classification.includes("regulated") || classification.includes("pii");
  if (metadata.trainingUsageAllowed === true && restrictedData) {
    score += 5;
    reasons.push("Training usage is enabled for restricted/regulated data.");
  }

  const promptRetention = lower(metadata.promptRetentionPolicy);
  const responseRetention = lower(metadata.responseRetentionPolicy);
  if (!promptRetention || !responseRetention || promptRetention === "unknown" || responseRetention === "unknown") {
    score += 4;
    reasons.push("Retention policy is unknown/incomplete.");
  }

  if (!metadata.modelVersion) {
    score += 2;
    reasons.push("Model version missing.");
  }
  if (!metadata.hostingType) {
    score += 2;
    reasons.push("Hosting type unclear.");
  }

  const lowRiskSignal =
    metadata.approvedForSensitiveCode === true &&
    metadata.approvedForRegulatedWorkloads === true &&
    metadata.trainingUsageAllowed === false &&
    Boolean(promptRetention) &&
    Boolean(responseRetention) &&
    (host.includes("internal") || host.includes("self-host"));
  if (lowRiskSignal) {
    reasons.push("Approved internal model with no training usage and clear retention policies.");
    return { level: "LOW", rationale: reasons };
  }

  if (score >= 7) return { level: "HIGH", rationale: reasons };
  if (score >= 3) return { level: "MEDIUM", rationale: reasons };
  reasons.push("No high-risk indicators detected.");
  return { level: "LOW", rationale: reasons };
}

export function validateModelAllowedForContext(
  metadataInput: ModelMetadataInput,
  context: ModelValidationContext,
): { allowed: boolean; rationale: string[]; risk: ModelRiskAssessment } {
  const metadata = normalizeModelMetadata(metadataInput);
  const risk = assessModelRisk(metadata);
  const reasons: string[] = [];

  const disallowed = new Set((context.disallowedJurisdictions ?? []).map((x) => x.toLowerCase()));
  if (metadata.jurisdiction && disallowed.has(metadata.jurisdiction.toLowerCase())) {
    reasons.push(`Jurisdiction '${metadata.jurisdiction}' is not allowed for this context.`);
  }

  if (context.requiresSensitiveCode && metadata.approvedForSensitiveCode !== true) {
    reasons.push("Model is not approved for sensitive code.");
  }
  if (context.regulatedWorkload && metadata.approvedForRegulatedWorkloads !== true) {
    reasons.push("Model is not approved for regulated workloads.");
  }

  const classification = lower(context.dataClassification ?? metadata.dataClassification);
  if (metadata.trainingUsageAllowed === true && (classification.includes("restricted") || classification.includes("regulated"))) {
    reasons.push("Training usage with restricted/regulated classification is not allowed.");
  }

  if (risk.level === "HIGH") {
    reasons.push("Risk assessment is HIGH.");
  }

  return {
    allowed: reasons.length === 0,
    rationale: reasons.length ? reasons : ["Model is allowed for context."],
    risk,
  };
}

export async function getModelGovernanceSummary(
  filters: {
    startAt?: Date;
    endAt?: Date;
    provider?: string;
    jurisdiction?: string;
    limit?: number;
  } = {},
  prisma?: PrismaClient | null,
): Promise<ModelGovernanceSummary> {
  const client = prisma ?? getPrisma();
  if (!client) {
    return {
      totalRecords: 0,
      byRisk: { LOW: 0, MEDIUM: 0, HIGH: 0 },
      byProvider: {},
      byJurisdiction: {},
    };
  }

  const rows = await client.modelUsage.findMany({
    where: {
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.jurisdiction ? { jurisdiction: filters.jurisdiction } : {}),
      ...(filters.startAt || filters.endAt
        ? {
            createdAt: {
              ...(filters.startAt ? { gte: filters.startAt } : {}),
              ...(filters.endAt ? { lte: filters.endAt } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 1000,
  });

  const summary: ModelGovernanceSummary = {
    totalRecords: rows.length,
    byRisk: { LOW: 0, MEDIUM: 0, HIGH: 0 },
    byProvider: {},
    byJurisdiction: {},
  };

  for (const row of rows) {
    const risk = assessModelRisk({
      provider: row.provider,
      modelName: row.modelName,
      modelVersion: row.modelVersion,
      hostingType: row.hostingType,
      endpointRegion: row.endpointRegion,
      dataProcessingRegion: row.dataProcessingRegion,
      userGeography: row.userGeography,
      jurisdiction: row.jurisdiction,
      promptRetentionPolicy: row.promptRetentionPolicy,
      responseRetentionPolicy: row.responseRetentionPolicy,
      trainingUsageAllowed: row.trainingUsageAllowed,
      trainingExposureRisk: row.trainingExposureRisk,
      dataClassification: row.dataClassification,
      approvedForSensitiveCode: row.approvedForSensitiveCode,
      approvedForRegulatedWorkloads: row.approvedForRegulatedWorkloads,
      modelPolicyVersion: row.modelPolicyVersion,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    });
    summary.byRisk[risk.level] += 1;
    summary.byProvider[row.provider] = (summary.byProvider[row.provider] ?? 0) + 1;
    const juris = row.jurisdiction || "unknown";
    summary.byJurisdiction[juris] = (summary.byJurisdiction[juris] ?? 0) + 1;
  }

  return summary;
}

export async function recordModelUsage(
  input: {
    traceId: string;
    decisionLogId?: string | null;
    interactionId?: string | null;
    metadata: ModelMetadataInput;
  },
  prisma?: PrismaClient | null,
): Promise<{ persisted: boolean; mode: "postgres" | "none"; recordId?: string }> {
  const client = prisma ?? getPrisma();
  if (!client) return { persisted: false, mode: "none" };
  const m = normalizeModelMetadata(input.metadata);
  const row = await client.modelUsage.create({
    data: {
      traceId: input.traceId,
      decisionLogId: input.decisionLogId ?? null,
      interactionId: input.interactionId ?? null,
      provider: m.provider,
      modelName: m.modelName,
      modelVersion: m.modelVersion ?? null,
      hostingType: m.hostingType ?? null,
      endpointRegion: m.endpointRegion ?? null,
      dataProcessingRegion: m.dataProcessingRegion ?? null,
      userGeography: m.userGeography ?? null,
      jurisdiction: m.jurisdiction ?? null,
      promptRetentionPolicy: m.promptRetentionPolicy ?? null,
      responseRetentionPolicy: m.responseRetentionPolicy ?? null,
      trainingUsageAllowed: m.trainingUsageAllowed ?? null,
      trainingExposureRisk: m.trainingExposureRisk ?? null,
      dataClassification: m.dataClassification ?? null,
      approvedForSensitiveCode: m.approvedForSensitiveCode ?? null,
      approvedForRegulatedWorkloads: m.approvedForRegulatedWorkloads ?? null,
      modelPolicyVersion: m.modelPolicyVersion ?? null,
      metadata: (m.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  return { persisted: true, mode: "postgres", recordId: row.id };
}
