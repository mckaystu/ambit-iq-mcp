import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeployShadowRequest,
  buildGenerateRequest,
  buildShadowImpactRequest,
  buildVimlPreviewRequest,
  postPolicyManager,
} from "./policyManagerApi";

describe("policyManagerApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("buildGenerateRequest omits viml when blank", () => {
    expect(buildGenerateRequest("hello", "  ")).toEqual({ action: "generate", intent: "hello" });
  });

  it("buildGenerateRequest includes viml when present", () => {
    expect(buildGenerateRequest("hello", "vibe:\n  intent: x\n")).toMatchObject({
      action: "generate",
      intent: "hello",
      viml: "vibe:\n  intent: x\n",
    });
  });

  it("buildVimlPreviewRequest includes sample_code when non-empty", () => {
    expect(buildVimlPreviewRequest("vibe:\n  intent: a\n", "code")).toEqual({
      action: "viml-preview",
      viml: "vibe:\n  intent: a\n",
      sample_code: "code",
    });
  });

  it("buildDeployShadowRequest merges viml", () => {
    expect(
      buildDeployShadowRequest({
        original_intent: "i",
        rego_code: "p",
        rule_name: "n",
        rule_logic: { id: "1" },
        viml: "vibe:\n  intent: z\n",
      }),
    ).toMatchObject({
      action: "deploy-shadow",
      viml: "vibe:\n  intent: z\n",
      rule_logic: { id: "1" },
    });
  });

  it("postPolicyManager surfaces non-JSON API bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("A server error has occurred"),
      }),
    );
    const result = await postPolicyManager({ action: "generate", intent: "test" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("non-JSON");
      expect(result.error).toContain("A server error");
    }
  });

  it("buildShadowImpactRequest passes viml and hours", () => {
    expect(
      buildShadowImpactRequest({
        rego_code: "x",
        hours: 48,
        viml: "vibe:\n  intent: q\n",
      }),
    ).toEqual({
      action: "shadow-impact",
      rego_code: "x",
      hours: 48,
      viml: "vibe:\n  intent: q\n",
    });
  });
});
