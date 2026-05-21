import { getPrisma } from "./audit.service.js";
import { assessModelRisk } from "./model-governance.service.js";

function normFindings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => JSON.stringify(x)).sort();
}

export async function compareOriginalVsReplay(input: {
  originalDecision: boolean | null;
  replayDecision: boolean;
  originalFindings: unknown;
  replayFindings: unknown;
}) {
  const original = normFindings(input.originalFindings);
  const replay = normFindings(input.replayFindings);
  const added = replay.filter((f) => !original.includes(f));
  const removed = original.filter((f) => !replay.includes(f));
  const driftDetected =
    input.originalDecision !== null
      ? input.originalDecision !== input.replayDecision || added.length > 0 || removed.length > 0
      : added.length > 0 || removed.length > 0;
  let driftClass: "UNCHANGED" | "MORE_STRICT" | "MORE_PERMISSIVE" | "NEW_RISK_FOUND" = "UNCHANGED";
  if (driftDetected) {
    if (added.length > 0 && !removed.length) driftClass = "NEW_RISK_FOUND";
    else if (input.originalDecision === true && input.replayDecision === false) driftClass = "MORE_STRICT";
    else if (input.originalDecision === false && input.replayDecision === true) driftClass = "MORE_PERMISSIVE";
  }
  return { driftDetected, driftClass, changedFindings: { added, removed } };
}

export async function replayInteraction(interactionId: string) {
  const prisma = getPrisma();
  if (!prisma) return null;
  const interaction = await prisma.agentInteraction.findUnique({ where: { id: interactionId } });
  if (!interaction) return null;
  const modelUsage = await prisma.modelUsage.findFirst({
    where: { OR: [{ interactionId }, { traceId: interaction.traceId }] },
    orderBy: { createdAt: "desc" },
  });
  const decision = await prisma.ambitDecisionLog.findFirst({
    where: { traceId: interaction.traceId },
    orderBy: { timestamp: "desc" },
  });
  const risk = modelUsage
    ? assessModelRisk({
        provider: modelUsage.provider,
        modelName: modelUsage.modelName,
        modelVersion: modelUsage.modelVersion,
        hostingType: modelUsage.hostingType,
        jurisdiction: modelUsage.jurisdiction,
        promptRetentionPolicy: modelUsage.promptRetentionPolicy,
        responseRetentionPolicy: modelUsage.responseRetentionPolicy,
        trainingUsageAllowed: modelUsage.trainingUsageAllowed,
        dataClassification: modelUsage.dataClassification,
      })
    : { level: "MEDIUM" as const, rationale: ["No model usage metadata attached to interaction."] };
  const replayDecision = risk.level !== "HIGH";
  const replayFindings = risk.level === "HIGH" ? [{ ruleId: "MODEL-GOV-001", message: "High model risk." }] : [];
  const diff = await compareOriginalVsReplay({
    originalDecision: decision ? decision.decision : null,
    replayDecision,
    originalFindings: decision?.violations ?? [],
    replayFindings,
  });
  return {
    original: {
      interaction_id: interaction.id,
      trace_id: interaction.traceId,
      prompt_summary: interaction.promptRedacted ? interaction.promptRedacted.slice(0, 240) : null,
      model_metadata: modelUsage,
      proposed_code: interaction.proposedCodeRedacted,
      policy_decision: decision?.decision ?? null,
      findings: decision?.violations ?? [],
    },
    replay: {
      current_policy_decision: replayDecision,
      current_risk_result: risk,
      findings: replayFindings,
      explanation: risk.rationale.join(" "),
    },
    drift: diff,
  };
}

export async function replayIncident(incidentId: string) {
  const prisma = getPrisma();
  if (!prisma) return null;
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) return null;
  const decision = incident.traceId
    ? await prisma.ambitDecisionLog.findFirst({
        where: { traceId: incident.traceId },
        orderBy: { timestamp: "desc" },
      })
    : null;
  const replayDecision = decision ? decision.decision : true;
  const diff = await compareOriginalVsReplay({
    originalDecision: decision?.decision ?? null,
    replayDecision,
    originalFindings: decision?.violations ?? [],
    replayFindings: decision?.violations ?? [],
  });
  return {
    original: {
      incident_id: incident.id,
      trace_id: incident.traceId,
      decision: decision?.decision ?? null,
      findings: decision?.violations ?? [],
      metadata: incident.metadata,
    },
    replay: {
      current_policy_decision: replayDecision,
      current_risk_result: { level: "LOW", rationale: ["No policy drift for incident replay baseline."] },
      findings: decision?.violations ?? [],
      explanation: "Incident replay is based on latest stored decision for linked trace.",
    },
    drift: diff,
  };
}
