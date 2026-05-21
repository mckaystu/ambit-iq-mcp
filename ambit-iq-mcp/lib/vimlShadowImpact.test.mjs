import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  parseVimlDocument,
  runVimlEnforceFastPath,
  wrapVimlLogicPackage,
  vimlServerPreview,
  vimlDocFromEnforcePatterns,
} from "./vimlShadowImpact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "../test/fixtures", name), "utf8");

describe("vimlShadowImpact", () => {
  it("parseVimlDocument accepts valid minimal fixture", () => {
    const r = parseVimlDocument(fixture("viml-valid-min.yaml"));
    assert.equal(r.ok, true);
    if (r.ok) assert.match(String(r.doc.vibe.intent), /Fixture minimal/);
  });

  it("parseVimlDocument rejects invalid fixture", () => {
    const r = parseVimlDocument(fixture("viml-invalid-missing-intent.yaml"));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /vibe\.intent/i);
  });

  it("runVimlEnforceFastPath hits eval pattern", () => {
    const r = parseVimlDocument(fixture("viml-enforce-eval.yaml"));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { hits } = runVimlEnforceFastPath("foo eval(x) bar", r.doc);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].ruleId, "FIX-EVAL");
  });

  it("runVimlEnforceFastPath no hit when pattern absent", () => {
    const r = parseVimlDocument(fixture("viml-enforce-eval.yaml"));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const { hits } = runVimlEnforceFastPath("console.log(1)", r.doc);
    assert.equal(hits.length, 0);
  });

  it("wrapVimlLogicPackage adds package when missing", () => {
    const w = wrapVimlLogicPackage("allow := true\n", "my_rule");
    assert.match(w, /^package agent\.gate\.my_rule\n\nallow := true/m);
  });

  it("wrapVimlLogicPackage leaves existing package", () => {
    const body = "package foo.bar\n\np := 1\n";
    assert.equal(wrapVimlLogicPackage(body, "ignored"), body.trim());
  });

  it("vimlServerPreview includes wrapped rego excerpt", () => {
    const r = parseVimlDocument(`vibe:\n  intent: x\nlogic: |\n  allow := true\n`);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const p = vimlServerPreview(r.doc, {});
    assert.equal(p.has_wrapped_rego, true);
    assert.match(p.viml_wrapped_rego_preview, /package agent\.gate\./);
  });

  it("vimlDocFromEnforcePatterns builds runnable doc", () => {
    const doc = vimlDocFromEnforcePatterns(["a"], "fail");
    const { hits } = runVimlEnforceFastPath("xa", doc);
    assert.equal(hits.length, 1);
  });
});
