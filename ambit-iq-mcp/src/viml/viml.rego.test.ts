import assert from "node:assert";
import { describe, it } from "node:test";
import { wrapVimlLogicPackage } from "./viml.rego.js";

describe("wrapVimlLogicPackage", () => {
  it("prefixes package from vibe id when body has no package", () => {
    const out = wrapVimlLogicPackage("default allow := true\n", "rule_1");
    assert.match(out, /^package agent\.gate\.rule_1\n\n/);
    assert.match(out, /default allow := true/);
  });

  it("does not wrap when package already present", () => {
    const body = "package custom\n\nx := 1\n";
    assert.equal(wrapVimlLogicPackage(body, "x"), body.trim());
  });
});
