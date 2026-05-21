import { describe, expect, it } from "vitest";
import { hashContent, redactSensitiveContent } from "./prompt-capture.service.js";

describe("prompt-capture.service", () => {
  it("redacts token", () => {
    const input = "Authorization: Bearer abcdefghijklmnop12345";
    const out = redactSensitiveContent(input);
    expect(out.redacted).toContain("Bearer [REDACTED_TOKEN]");
    expect(out.redacted).not.toContain("abcdefghijklmnop12345");
  });

  it("truncates long prompt", () => {
    const long = "x".repeat(1000);
    const out = redactSensitiveContent(long, { maxLength: 80 });
    expect(out.truncated).toBe(true);
    expect(out.redacted.length).toBeLessThanOrEqual(80);
  });

  it("hashes consistently", () => {
    const a = hashContent("same");
    const b = hashContent("same");
    const c = hashContent("different");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
