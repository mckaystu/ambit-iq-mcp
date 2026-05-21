import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ModelMetadataSchema } from "../schemas/governance.schemas.js";
import {
  assessModelRisk,
  getModelGovernanceSummary,
  normalizeModelMetadata,
  validateModelAllowedForContext,
} from "../services/model-governance.service.js";
import { errorResponse, successResponse } from "../services/response-contract.service.js";

const SummaryFilterSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  provider: z.string().optional(),
  model_name: z.string().optional(),
  jurisdiction: z.string().optional(),
  data_classification: z.string().optional(),
  hosting_type: z.string().optional(),
});

const ValidateContextSchema = z.object({
  repo: z.string().optional(),
  team_id: z.string().optional(),
  environment: z.string().optional(),
  data_classification: z.string().optional(),
  jurisdiction: z.string().optional(),
  regulated_workload: z.boolean().optional(),
});

const AssessSchema = z.object({
  model: ModelMetadataSchema,
});
const ValidateSchema = z.object({
  model: ModelMetadataSchema,
  context: ValidateContextSchema,
});

const mk = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export const MODEL_GOVERNANCE_TOOLS: Tool[] = [
  {
    name: "assess_model_risk",
    description: "Assess risk for model metadata and return rationale + recommendations.",
    inputSchema: { type: "object", properties: { model: { type: "object" } }, required: ["model"] },
  },
  {
    name: "get_model_governance_summary",
    description: "Aggregate governance usage/risk summary for model usage records.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string" },
        date_to: { type: "string" },
        provider: { type: "string" },
        model_name: { type: "string" },
        jurisdiction: { type: "string" },
        data_classification: { type: "string" },
        hosting_type: { type: "string" },
      },
    },
  },
  {
    name: "validate_model_for_context",
    description: "Validate model metadata for a workload context and return allow|warn|block style decision.",
    inputSchema: {
      type: "object",
      properties: { model: { type: "object" }, context: { type: "object" } },
      required: ["model", "context"],
    },
  },
];

export async function handleModelGovernanceTool(name: string, args: unknown) {
  if (!MODEL_GOVERNANCE_TOOLS.some((t) => t.name === name)) return null;

  if (name === "assess_model_risk") {
    const parsed = AssessSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid model metadata.", { errors: parsed.error.issues.map((i) => i.message) }));
    const normalized = normalizeModelMetadata(parsed.data.model);
    const risk = assessModelRisk(normalized);
    const missingFields = [
      !normalized.modelVersion ? "modelVersion" : "",
      !normalized.hostingType ? "hostingType" : "",
      !normalized.promptRetentionPolicy ? "promptRetentionPolicy" : "",
      !normalized.responseRetentionPolicy ? "responseRetentionPolicy" : "",
    ].filter(Boolean);
    const recommended_action = risk.level === "HIGH" ? "block" : risk.level === "MEDIUM" ? "warn" : "allow";
    return mk(successResponse(name, { risk, missingFields, recommended_action }, "Model risk assessed."));
  }

  if (name === "get_model_governance_summary") {
    const parsed = SummaryFilterSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid governance filters.", { errors: parsed.error.issues.map((i) => i.message) }));
    const summary = await getModelGovernanceSummary({
      startAt: parseDate(parsed.data.date_from),
      endAt: parseDate(parsed.data.date_to),
      provider: parsed.data.provider,
      jurisdiction: parsed.data.jurisdiction,
    });
    return mk(successResponse(name, summary, "Model governance summary computed."));
  }

  if (name === "validate_model_for_context") {
    const parsed = ValidateSchema.safeParse(args ?? {});
    if (!parsed.success) return mk(errorResponse(name, "Invalid model/context payload.", { errors: parsed.error.issues.map((i) => i.message) }));
    const normalized = normalizeModelMetadata(parsed.data.model);
    const res = validateModelAllowedForContext(normalized, {
      regulatedWorkload: parsed.data.context.regulated_workload,
      dataClassification: parsed.data.context.data_classification,
      disallowedJurisdictions: parsed.data.context.jurisdiction ? [parsed.data.context.jurisdiction] : [],
      requiresSensitiveCode: ["restricted", "regulated"].includes(
        String(parsed.data.context.data_classification ?? "").toLowerCase(),
      ),
    });
    const decision = res.allowed ? (res.risk.level === "LOW" ? "allow" : "warn") : "block";
    return mk(successResponse(name, { allowed: res.allowed, decision, violations: res.allowed ? [] : res.rationale, rationale: res.rationale }, "Model validation complete."));
  }

  return null;
}
