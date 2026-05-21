import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { resolveShadowImpactMatcher } from "./shadowImpactResolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evalFixture = readFileSync(path.join(__dirname, "../test/fixtures/viml-enforce-eval.yaml"), "utf8");

describe("resolveShadowImpactMatcher", () => {
  it("prefers viml over rego and enforce_patterns", () => {
    const r = resolveShadowImpactMatcher({
      rego_code: '# AGENT_GATE:test NEVER_MATCH_XXX\n',
      viml: evalFixture,
      enforce_patterns: ["NEVER"],
    });
    assert.equal(r.type, "scan");
    if (r.type !== "scan") return;
    assert.equal(r.impact_mode, "viml");
    assert.equal(r.wouldFlag("eval(1)"), true);
    assert.equal(r.wouldFlag("safe"), false);
  });

  it("uses enforce_patterns when no viml", () => {
    const r = resolveShadowImpactMatcher({
      rego_code: "",
      enforce_patterns: [{ pattern: "secret" }],
    });
    assert.equal(r.type, "scan");
    if (r.type !== "scan") return;
    assert.equal(r.impact_mode, "enforce_patterns");
    assert.equal(r.wouldFlag("mysecret"), true);
  });

  it("returns ENFORCE_EMPTY when enforce_patterns yields no patterns", () => {
    const r = resolveShadowImpactMatcher({
      rego_code: "",
      enforce_patterns: [{}],
    });
    assert.equal(r.type, "error");
    if (r.type !== "error") return;
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "ENFORCE_EMPTY");
  });

  it("returns VIML_PARSE for bad yaml", () => {
    const r = resolveShadowImpactMatcher({ viml: "not: yaml: [[[" });
    assert.equal(r.type, "error");
    if (r.type !== "error") return;
    assert.equal(r.json.code, "VIML_PARSE");
  });

  it("regex mode matches comment pattern", () => {
    const r = resolveShadowImpactMatcher({
      rego_code: '# AGENT_GATE:test password\\s*=\n',
    });
    assert.equal(r.type, "scan");
    if (r.type !== "scan") return;
    assert.equal(r.impact_mode, "regex");
    assert.equal(r.wouldFlag("const password = 1"), true);
  });

  it("empty when no viml, enforce, or comment", () => {
    const r = resolveShadowImpactMatcher({ rego_code: "package x\n" });
    assert.equal(r.type, "empty");
    if (r.type !== "empty") return;
    assert.equal(r.json.flagged_total, 0);
    assert.ok(String(r.json.note || "").includes("viml"));
  });

  it("regex invalid returns 400", () => {
    const r = resolveShadowImpactMatcher({
      rego_code: "# AGENT_GATE:test (\n",
    });
    assert.equal(r.type, "error");
    if (r.type !== "error") return;
    assert.equal(r.status, 400);
  });
});
