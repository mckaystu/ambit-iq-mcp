import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  processVimlPreviewRequest,
  validateOptionalVimlForGenerate,
  buildGeneratePayloadVimlPreview,
  mergeVimlDocumentIntoRuleLogic,
} from "./vimlPolicyIdeActions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const validYaml = readFileSync(path.join(__dirname, "../test/fixtures/viml-valid-min.yaml"), "utf8");

describe("vimlPolicyIdeActions", () => {
  it("processVimlPreviewRequest requires viml", () => {
    const r = processVimlPreviewRequest({});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 400);
  });

  it("processVimlPreviewRequest returns preview and sample_enforce_hit", () => {
    const r = processVimlPreviewRequest({
      viml: validYaml.replace("enforce: []", 'enforce:\n  - pattern: "Fixture"\n    id: T'),
      sample_code: "Fixture minimal",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.json.ok, true);
    const p = r.json.viml_preview;
    assert.ok(p && typeof p === "object");
    assert.equal(p.sample_enforce_hit, true);
    assert.equal(p.sample_enforce_hit_count, 1);
  });

  it("validateOptionalVimlForGenerate skips empty", () => {
    const r = validateOptionalVimlForGenerate("  ");
    assert.equal(r.ok, true);
    assert.equal(r.skip, true);
  });

  it("validateOptionalVimlForGenerate rejects bad yaml", () => {
    const r = validateOptionalVimlForGenerate("vibe: {}\n");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 400);
  });

  it("buildGeneratePayloadVimlPreview returns null when empty", () => {
    assert.equal(buildGeneratePayloadVimlPreview(""), null);
  });

  it("mergeVimlDocumentIntoRuleLogic preserves keys", () => {
    const m = mergeVimlDocumentIntoRuleLogic({ id: "R1", pattern: "x" }, validYaml);
    assert.equal(m.ok, true);
    if (!m.ok) return;
    assert.equal(m.rule_logic.id, "R1");
    assert.ok(String(m.rule_logic.viml_document || "").includes("vibe:"));
  });

  it("mergeVimlDocumentIntoRuleLogic rejects invalid viml", () => {
    const m = mergeVimlDocumentIntoRuleLogic({}, "vibe: {}");
    assert.equal(m.ok, false);
    if (m.ok) return;
    assert.equal(m.json.code, "VIML_PARSE");
  });
});
