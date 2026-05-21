import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { evaluatePolicy } from "../services/opa.client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enforceFixture = readFileSync(path.join(__dirname, "../../test/fixtures/viml-enforce-eval.yaml"), "utf8");

function emptyAudit() {
  return { gate: "pass", findings: [] };
}

describe("evaluatePolicy + viml_policy", () => {
  const prevOpa = process.env.OPA_URL;

  beforeEach(() => {
    delete process.env.OPA_URL;
  });

  afterEach(() => {
    if (prevOpa === undefined) delete process.env.OPA_URL;
    else process.env.OPA_URL = prevOpa;
  });

  it("returns viml_enforce when enforce pattern matches code", async () => {
    const r = await evaluatePolicy(
      {
        code: "eval(window.x)",
        intent_prompt: "p",
        profile_id: "baseline.global",
        viml_policy: enforceFixture,
      },
      (code, profileId) => emptyAudit(),
    );
    assert.equal(r.allow, false);
    assert.equal(r.source, "viml_enforce");
    assert.ok(Array.isArray(r.violations) && r.violations.length >= 1);
  });

  it("passes through to agent_gate_bridge when enforce does not match", async () => {
    const r = await evaluatePolicy(
      {
        code: "const x = 1;",
        intent_prompt: "p",
        profile_id: "baseline.global",
        viml_policy: enforceFixture,
      },
      (code, profileId) => emptyAudit(),
    );
    assert.equal(r.allow, true);
    assert.equal(r.source, "agent_gate_bridge");
    assert.ok(
      r.raw &&
        typeof r.raw === "object" &&
        (r.raw as { bridge?: string }).bridge === "agent_gate_policy_engine",
    );
  });

  it("denies with VIML_PARSE when viml_policy is invalid YAML", async () => {
    const r = await evaluatePolicy(
      {
        code: "x",
        intent_prompt: "p",
        profile_id: "baseline.global",
        viml_policy: "vibe: {}",
      },
      () => emptyAudit(),
    );
    assert.equal(r.allow, false);
    assert.equal(r.source, "agent_gate_bridge");
    assert.ok(
      r.raw &&
        typeof r.raw === "object" &&
        String((r.raw as { viml_parse_error?: string }).viml_parse_error || "").length > 0,
    );
  });
});
