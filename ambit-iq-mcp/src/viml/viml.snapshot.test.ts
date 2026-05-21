import assert from "node:assert";
import { describe, it } from "node:test";
import { VimlDocumentSchema } from "./viml.schema.js";
import { vimlDocumentForLog } from "./viml.snapshot.js";

describe("vimlDocumentForLog", () => {
  it("truncates long logic and sets logic_truncated", () => {
    const logic = "x".repeat(25_000);
    const doc = VimlDocumentSchema.parse({
      vibe: { intent: "t" },
      logic,
    });
    const out = vimlDocumentForLog(doc, 1000);
    assert.equal(String(out.logic).length, 1000);
    assert.equal(out.logic_truncated, true);
  });

  it("does not set logic_truncated when short", () => {
    const doc = VimlDocumentSchema.parse({
      vibe: { intent: "t" },
      logic: "allow := true\n",
    });
    const out = vimlDocumentForLog(doc);
    assert.equal("logic_truncated" in out, false);
    assert.match(String(out.logic), /allow/);
  });
});
