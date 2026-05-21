import { describe, expect, it } from "vitest";
import {
  assessModelRisk,
  normalizeModelMetadata,
  validateModelAllowedForContext,
} from "./model-governance.service.js";

describe("model-governance.service", () => {
  it("high risk external regulated model", () => {
    const risk = assessModelRisk(
      normalizeModelMetadata({
        provider: "openai",
        modelName: "gpt-x",
        hostingType: "external-saas",
        trainingUsageAllowed: true,
        dataClassification: "restricted",
        promptRetentionPolicy: "unknown",
        responseRetentionPolicy: "unknown",
      }),
    );
    expect(risk.level).toBe("HIGH");
    expect(risk.rationale.join(" ")).toContain("External/SaaS");
  });

  it("medium risk incomplete metadata", () => {
    const risk = assessModelRisk({
      provider: "internal",
      modelName: "foo",
      hostingType: "",
      modelVersion: undefined,
      promptRetentionPolicy: "30d",
      responseRetentionPolicy: "30d",
    });
    expect(risk.level).toBe("MEDIUM");
  });

  it("low risk approved internal model", () => {
    const metadata = normalizeModelMetadata({
      provider: "hcl",
      modelName: "safe-1",
      modelVersion: "2026.04",
      hostingType: "internal",
      promptRetentionPolicy: "30d",
      responseRetentionPolicy: "30d",
      trainingUsageAllowed: false,
      approvedForSensitiveCode: true,
      approvedForRegulatedWorkloads: true,
    });
    const risk = assessModelRisk(metadata);
    expect(risk.level).toBe("LOW");

    const validation = validateModelAllowedForContext(metadata, {
      requiresSensitiveCode: true,
      regulatedWorkload: true,
      disallowedJurisdictions: ["cn"],
    });
    expect(validation.allowed).toBe(true);
  });
});
