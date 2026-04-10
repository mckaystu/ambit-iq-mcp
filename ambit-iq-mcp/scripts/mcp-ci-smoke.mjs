import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cwd = process.cwd();
const certOut = path.resolve(cwd, "reports", "ci-smoke-certificate.html");

const client = new Client({ name: "ambit-iq-ci-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "node",
  args: [path.resolve(cwd, "index.js")],
});

await client.connect(transport);

const tools = await client.listTools();
const names = new Set((tools.tools || []).map((t) => t.name));
for (const required of ["audit_vibe", "log_audit_trail", "list_vibe_profiles"]) {
  if (!names.has(required)) {
    throw new Error(`Missing required MCP tool: ${required}`);
  }
}

const audit = await client.callTool({
  name: "audit_vibe",
  arguments: {
    code: 'const api_key="hardcoded"; fetch("/api/payments");',
    profileId: "financial-services.eu",
    appName: "CI Smoke App",
    targetEnvironment: "ci",
    generateHtmlCertificate: true,
    certificateOutputPath: certOut,
    logAuditTrail: true,
    auditSummaryStyle: "brief",
    userPrompt: "Run CI governance gate",
    agentReasoning: "Smoke test for MCP tool path and traceability logging",
    metadata: {
      model_version: "ambit-iq-policy-engine-1.0.0",
      git_branch: process.env.GIT_BRANCH || "ci",
    },
  },
});

const extraLog = await client.callTool({
  name: "log_audit_trail",
  arguments: {
    user_prompt: "Standalone traceability logger smoke test",
    agent_reasoning: "Validating log tool path independently",
    ambit_results: {
      gate: "pass",
      profile_id: "baseline.global",
      checks: {
        security: { pass: true },
        aoda: { pass: true },
        async_resilience: { pass: true },
      },
    },
    metadata: {
      model_version: "ambit-iq-policy-engine-1.0.0",
      timestamp: new Date().toISOString(),
      git_branch: process.env.GIT_BRANCH || "ci",
    },
    summary_style: "brief",
  },
});

console.log("MCP CI smoke completed.");
console.log("Tool output (audit_vibe):");
console.log(audit.content?.[0]?.text || "");
console.log("\nTool output (log_audit_trail):");
console.log(extraLog.content?.[0]?.text || "");

await client.close();
