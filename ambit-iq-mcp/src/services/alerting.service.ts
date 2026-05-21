import { Prisma } from "@prisma/client";
import { getPrisma } from "./audit.service.js";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertEventType =
  | "critical_incident_created"
  | "blocked_risky_commit_spike"
  | "compliance_score_below_threshold"
  | "high_risk_model_detected"
  | "suspicious_prompt_pattern_surge"
  | "chain_integrity_failure"
  | "test_alert";

export interface AlertEvent {
  type: AlertEventType;
  severity: AlertSeverity;
  title: string;
  message: string;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}

const severityRank: Record<AlertSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function minSeverity(): AlertSeverity {
  const raw = String(process.env.AMBIT_ALERT_MIN_SEVERITY || "high").toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") return raw;
  return "high";
}

async function postWebhook(url: string, payload: Record<string, unknown>) {
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function persistInternalAlert(event: AlertEvent) {
  const prisma = getPrisma();
  if (!prisma) return null;
  try {
    const row = await prisma.dashboardMetricSnapshot.create({
      data: {
        metricName: "alert_event",
        tenantId: event.tenantId ?? null,
        dimensions: {
          type: event.type,
          severity: event.severity,
          title: event.title,
        } as Prisma.InputJsonValue,
        value: {
          message: event.message,
          metadata: event.metadata ?? {},
          acknowledged: false,
        } as Prisma.InputJsonValue,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    });
    return row.id;
  } catch {
    return null;
  }
}

export async function sendAlert(event: AlertEvent): Promise<{ sent: boolean; channels: string[]; recordId?: string | null }> {
  if (severityRank[event.severity] < severityRank[minSeverity()]) {
    return { sent: false, channels: ["filtered_by_min_severity"] };
  }
  const channels: string[] = [];
  const recordId = await persistInternalAlert(event);
  channels.push("internal_audit_log_only");
  const slack = String(process.env.AMBIT_SLACK_WEBHOOK_URL || "").trim();
  const email = String(process.env.AMBIT_ALERT_EMAIL_WEBHOOK || "").trim();
  if (slack) {
    await postWebhook(slack, {
      text: `[${event.severity.toUpperCase()}] ${event.title}\n${event.message}`,
      event,
    });
    channels.push("slack");
  }
  if (email) {
    await postWebhook(email, { event });
    channels.push("email_webhook");
  }
  return { sent: true, channels, recordId };
}

export async function queueAlert(event: AlertEvent): Promise<{ queued: boolean; recordId?: string | null }> {
  const recordId = await persistInternalAlert(event);
  return { queued: true, recordId };
}

export async function evaluateThresholdAlerts(): Promise<{ evaluated: number; triggered: number }> {
  const prisma = getPrisma();
  if (!prisma) return { evaluated: 0, triggered: 0 };
  let triggered = 0;
  let incidents = 0;
  try {
    incidents = await prisma.incident.count({
      where: { severity: { in: ["CRITICAL", "HIGH"] }, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
  } catch {
    return { evaluated: 1, triggered: 0 };
  }
  if (incidents > 5) {
    await sendAlert({
      type: "critical_incident_created",
      severity: "high",
      title: "Critical incident spike",
      message: `${incidents} high/critical incidents in the last hour.`,
    });
    triggered += 1;
  }
  return { evaluated: 1, triggered };
}
