import { z } from "zod";

/** Declarative fast-path: regex match against proposed source (JavaScript RegExp, case-insensitive by default). */
export const VimlEnforceEntrySchema = z.object({
  id: z.string().optional(),
  pattern: z.string().optional(),
  message: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical", "BLOCKER", "HIGH", "MEDIUM", "LOW"]).optional(),
});

export const VimlVibeSchema = z.object({
  intent: z.string().min(1, "vibe.intent is required"),
  priority: z.string().optional(),
  category: z.string().optional(),
  /** Profile id (e.g. baseline.global) — filters catalog rules for deep-path. */
  profile: z.string().optional().default("baseline.global"),
  /** Stable id for OPA package suffix: agent.gate.<id> */
  id: z.string().optional(),
});

export const VimlTargetSchema = z.object({
  files: z.array(z.string()).optional(),
  tenant_id: z.string().nullable().optional(),
});

export const VimlDocumentSchema = z.object({
  vibe: VimlVibeSchema,
  target: VimlTargetSchema.optional(),
  enforce: z.array(VimlEnforceEntrySchema).optional().default([]),
  logic: z.string().optional().default(""),
  on_failure: z.string().optional().default("Policy violation."),
});

export type VimlDocument = z.infer<typeof VimlDocumentSchema>;
export type VimlEnforceEntry = z.infer<typeof VimlEnforceEntrySchema>;
