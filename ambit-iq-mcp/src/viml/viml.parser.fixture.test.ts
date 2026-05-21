import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseVimlDocument } from "./viml.parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "../../test/fixtures", name), "utf8");

describe("parseVimlDocument (fixtures)", () => {
  it("parses valid minimal YAML", () => {
    const r = parseVimlDocument(fixture("viml-valid-min.yaml"));
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.doc.vibe.intent.length > 0);
  });

  it("surfaces schema error for missing intent", () => {
    const r = parseVimlDocument(fixture("viml-invalid-missing-intent.yaml"));
    assert.equal(r.ok, false);
  });
});
