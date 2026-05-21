import assert from "node:assert";
import { describe, it } from "node:test";
import { buildRulesLibraryVimlDocumentUpdateSql, dollarDelimiterTag } from "./rulesLibraryVimlSql.mjs";

describe("rulesLibraryVimlSql", () => {
  it("buildRulesLibraryVimlDocumentUpdateSql contains jsonb merge and rule id", () => {
    const sql = buildRulesLibraryVimlDocumentUpdateSql(
      "550e8400-e29b-41d4-a716-446655440000",
      "vibe:\n  intent: x\n",
    );
    assert.match(sql, /UPDATE rules_library/);
    assert.match(sql, /jsonb_build_object\('viml_document'/);
    assert.match(sql, /550e8400-e29b-41d4-a716-446655440000/);
  });

  it("dollarDelimiterTag is stable for same input", () => {
    const y = "hello";
    assert.equal(dollarDelimiterTag(y), dollarDelimiterTag(y));
  });
});
