import assert from "node:assert";
import { describe, it } from "node:test";
import { extractAgentGateTestPattern, normalizeAgentGateRegexSource } from "./agentGateRegexComment.mjs";

describe("agentGateRegexComment", () => {
  it("extracts AGENT_GATE and AMBIT test patterns", () => {
    assert.equal(extractAgentGateTestPattern('# AGENT_GATE:test foo\\('), "foo\\(");
    assert.equal(extractAgentGateTestPattern('  # AMBIT:test bar+'), "bar+");
    assert.equal(extractAgentGateTestPattern("no comment"), null);
  });

  it("rejects overlong pattern", () => {
    const long = "a".repeat(300);
    assert.equal(extractAgentGateTestPattern(`# AGENT_GATE:test ${long}`), null);
  });

  it("normalizeAgentGateRegexSource strips (?i) and keeps flags", () => {
    const n = normalizeAgentGateRegexSource("(?i)foo");
    assert.equal(n.source, "foo");
    assert.equal(n.flags, "i");
  });

  it("normalizeAgentGateRegexSource maps m and s", () => {
    const n = normalizeAgentGateRegexSource("(?im)^line$");
    assert.equal(n.source, "^line$");
    assert.ok(n.flags.includes("m"));
    assert.ok(n.flags.includes("i"));
  });
});
