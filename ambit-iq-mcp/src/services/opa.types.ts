/**
 * OPA REST API shapes (strict interfaces for evaluatePolicy).
 * @see https://www.openpolicyagent.org/docs/latest/rest-api/
 */

export interface OpaEvaluationInput {
  code: string;
  intent_prompt: string;
  profile_id?: string;
  /**
   * Optional VIML (YAML): vibe / target / enforce / logic / on_failure.
   * Enforce patterns run first; vibe.profile overrides profile_id for catalog scans.
   */
  viml_policy?: string;
}

/** Typical custom decision document returned by Rego (adjust to your bundle). */
export interface OpaDecisionDocument {
  allow?: boolean;
  violations?: OpaViolation[];
  [key: string]: unknown;
}

export interface OpaViolation {
  rule: string;
  message?: string;
  severity?: string;
}

export interface OpaHttpResponse {
  result?: OpaDecisionDocument;
  decision_id?: string;
}

export interface OpaEvaluationResult {
  /** true = allow (no blocking violations per OPA or bridge). */
  allow: boolean;
  violations: OpaViolation[];
  /** Full HTTP JSON body or synthetic bridge payload (masked before DB write). */
  raw: unknown;
  source: "opa_rest" | "agent_gate_bridge" | "viml_enforce";
}
