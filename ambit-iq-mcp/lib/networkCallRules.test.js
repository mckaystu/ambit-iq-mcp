import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runPolicyAudit } from "./policyFramework.js";

describe("networkCallRules (AST-scoped QUAL-002 / DORA-001)", () => {
  it("QUAL-002: ignores try/catch that does not wrap fetch", () => {
    const code = `try { helper(); } catch (e) {}
fetch("/x");`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(r.findings.some((f) => f.ruleId === "QUAL-002"));
  });

  it("QUAL-002: passes when fetch is inside try", () => {
    const code = `try { fetch("/x"); } catch (e) {}`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(!r.findings.some((f) => f.ruleId === "QUAL-002"));
  });

  it("QUAL-002: passes when fetch uses .catch chain", () => {
    const code = `fetch("/x").then((r) => r).catch(() => {});`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(!r.findings.some((f) => f.ruleId === "QUAL-002"));
  });

  it("DORA-001: ignores AbortController mention that is not on the fetch call", () => {
    const code = `const c = new AbortController();
fetch("/x");`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(r.findings.some((f) => f.ruleId === "DORA-001"));
  });

  it("DORA-001: passes when options object includes signal", () => {
    const code = `fetch("/x", { signal: AbortSignal.timeout(5000) });`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(!r.findings.some((f) => f.ruleId === "DORA-001"));
  });

  it("DORA-001: passes axios config with timeout", () => {
    const code = `axios.get("/x", { timeout: 5000 });`;
    const r = runPolicyAudit(code, "financial-services.eu");
    assert.ok(!r.findings.some((f) => f.ruleId === "DORA-001"));
  });
});
