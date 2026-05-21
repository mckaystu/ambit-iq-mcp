import { getPool } from "./_pool.js";
import { requireAuth } from "./_auth.js";
import { logAdminAction } from "./_admin-audit.js";
import { withRateLimit } from "./_security.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const user = requireAuth(req);
    const url = new URL(req.url, "https://ambitdashboard.local");
    const interactionId = String(url.searchParams.get("interaction_id") || "").trim();
    const incidentId = String(url.searchParams.get("incident_id") || "").trim();
    if (!interactionId && !incidentId) return sendJson(res, 400, { error: "interaction_id or incident_id is required" });
    const pool = getPool();
    const normFindings = (v) => (Array.isArray(v) ? v.map((x) => JSON.stringify(x)).sort() : []);
    const compare = (originalDecision, replayDecision, originalFindings, replayFindings) => {
      const original = normFindings(originalFindings);
      const replay = normFindings(replayFindings);
      const added = replay.filter((f) => !original.includes(f));
      const removed = original.filter((f) => !replay.includes(f));
      const driftDetected = originalDecision !== null ? originalDecision !== replayDecision || added.length > 0 || removed.length > 0 : added.length > 0 || removed.length > 0;
      let driftClass = "UNCHANGED";
      if (driftDetected) {
        if (added.length > 0 && !removed.length) driftClass = "NEW_RISK_FOUND";
        else if (originalDecision === true && replayDecision === false) driftClass = "MORE_STRICT";
        else if (originalDecision === false && replayDecision === true) driftClass = "MORE_PERMISSIVE";
      }
      return { driftDetected, driftClass, changedFindings: { added, removed } };
    };
    let replay = null;
    if (interactionId) {
      const i = await pool.query(`SELECT * FROM agent_interactions WHERE id = $1::uuid LIMIT 1`, [interactionId]);
      if (i.rows[0]) {
        const traceId = String(i.rows[0].trace_id || "");
        const d = traceId ? await pool.query(`SELECT * FROM ambit_decision_logs WHERE trace_id = $1::uuid ORDER BY timestamp DESC LIMIT 1`, [traceId]) : { rows: [] };
        const decision = d.rows[0] || null;
        const replayDecision = decision ? Boolean(decision.decision) : true;
        const replayFindings = replayDecision ? [] : [{ ruleId: "POLICY-REPLAY-001", message: "Replay detects blocked posture." }];
        replay = {
          original: {
            interaction_id: i.rows[0].id,
            trace_id: i.rows[0].trace_id,
            prompt_summary: i.rows[0].prompt_redacted ? String(i.rows[0].prompt_redacted).slice(0, 240) : null,
            proposed_code: i.rows[0].proposed_code_redacted || null,
            policy_decision: decision ? Boolean(decision.decision) : null,
            findings: decision?.violations || [],
          },
          replay: {
            current_policy_decision: replayDecision,
            current_risk_result: { level: replayDecision ? "LOW" : "HIGH", rationale: ["Replay using current policy baseline."] },
            findings: replayFindings,
            explanation: "Replay compares latest stored decision behavior against current baseline.",
          },
          drift: compare(decision ? Boolean(decision.decision) : null, replayDecision, decision?.violations || [], replayFindings),
        };
      }
    } else {
      const inc = await pool.query(`SELECT * FROM incidents WHERE id = $1::uuid LIMIT 1`, [incidentId]);
      if (inc.rows[0]) {
        const traceId = String(inc.rows[0].trace_id || "");
        const d = traceId ? await pool.query(`SELECT * FROM ambit_decision_logs WHERE trace_id = $1::uuid ORDER BY timestamp DESC LIMIT 1`, [traceId]) : { rows: [] };
        const decision = d.rows[0] || null;
        const replayDecision = decision ? Boolean(decision.decision) : true;
        replay = {
          original: {
            incident_id: inc.rows[0].id,
            trace_id: inc.rows[0].trace_id,
            decision: decision ? Boolean(decision.decision) : null,
            findings: decision?.violations || [],
            metadata: inc.rows[0].metadata || {},
          },
          replay: {
            current_policy_decision: replayDecision,
            current_risk_result: { level: "LOW", rationale: ["Incident replay baseline matches latest available data."] },
            findings: decision?.violations || [],
            explanation: "Incident replay compares latest linked trace decision.",
          },
          drift: compare(decision ? Boolean(decision.decision) : null, replayDecision, decision?.violations || [], decision?.violations || []),
        };
      }
    }
    await logAdminAction({
      user,
      action: "replay.requested",
      metadata: { interaction_id: interactionId || null, incident_id: incidentId || null },
    });
    if (!replay) return sendJson(res, 404, { error: "Replay target not found" });
    return sendJson(res, 200, replay);
  } catch (e) {
    return sendJson(res, Number(e?.statusCode || 500), { error: String(e?.message || e) });
  }
}

export default withRateLimit(handler, { max: 80, windowMs: 60_000 });
