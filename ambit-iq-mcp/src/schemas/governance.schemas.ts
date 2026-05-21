import { z } from "zod";

export const ModelMetadataSchema = z.object({
  provider: z.string().min(1),
  modelName: z.string().min(1),
  modelVersion: z.string().optional(),
  hostingType: z.string().optional(),
  endpointRegion: z.string().optional(),
  dataProcessingRegion: z.string().optional(),
  userGeography: z.string().optional(),
  jurisdiction: z.string().optional(),
  promptRetentionPolicy: z.string().optional(),
  responseRetentionPolicy: z.string().optional(),
  trainingUsageAllowed: z.boolean().optional(),
  trainingExposureRisk: z.string().optional(),
  dataClassification: z.string().optional(),
  approvedForSensitiveCode: z.boolean().optional(),
  approvedForRegulatedWorkloads: z.boolean().optional(),
  modelPolicyVersion: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CaptureInteractionSchema = z.object({
  traceId: z.string().min(1),
  decisionLogId: z.string().optional(),
  sessionId: z.string().optional(),
  actorId: z.string().optional(),
  teamId: z.string().optional(),
  agentName: z.string().min(1),
  agentVersion: z.string().optional(),
  workspaceId: z.string().optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  prNumber: z.string().optional(),
  prompt: z.string().optional(),
  response: z.string().optional(),
  proposedCode: z.string().optional(),
  finalCode: z.string().optional(),
  accepted: z.boolean().optional(),
  capturePolicy: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DashboardFilterSchema = z.object({
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  teamId: z.string().optional(),
  actorId: z.string().optional(),
  repo: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const IncidentSearchSchema = z.object({
  incidentId: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  repo: z.string().optional(),
  actorId: z.string().optional(),
  traceId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const ResponseEnvelopeSchema = z.object({
  status: z.enum(["success", "error"]),
  tool: z.string(),
  trace_id: z.string(),
  generated_at: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
  summary: z.string(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  artifacts: z.array(z.string()),
  persistence: z.object({
    mode: z.enum(["postgres", "fallback_json", "none"]),
    record_ids: z.array(z.string()),
    fallback_path: z.string().nullable(),
    reason: z.string().nullable(),
  }),
});

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
export type CaptureInteraction = z.infer<typeof CaptureInteractionSchema>;
export type DashboardFilter = z.infer<typeof DashboardFilterSchema>;
export type IncidentSearch = z.infer<typeof IncidentSearchSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
