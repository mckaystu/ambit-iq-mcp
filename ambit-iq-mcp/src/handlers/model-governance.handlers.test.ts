import { describe, expect, it } from "vitest";
import { handleModelGovernanceTool } from "./model-governance.handlers.js";

describe("model-governance.handlers", () => {
  it("known tool returns non-null envelope", async () => {
    const res = await handleModelGovernanceTool("assess_model_risk", {
      model: { provider: "openai", modelName: "gpt-x" },
    });
    expect(res).not.toBeNull();
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("success");
    expect(parsed.data.risk).toBeDefined();
  });

  it("validation errors return structured error response", async () => {
    const res = await handleModelGovernanceTool("assess_model_risk", {});
    const parsed = JSON.parse((res as { content: Array<{ text: string }> }).content[0]?.text);
    expect(parsed.status).toBe("error");
    expect(Array.isArray(parsed.errors)).toBe(true);
  });

  it("unknown tool returns null", async () => {
    const res = await handleModelGovernanceTool("unknown_model_tool", {});
    expect(res).toBeNull();
  });
});
