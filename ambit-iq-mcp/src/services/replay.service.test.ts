import { describe, expect, it } from "vitest";
import { compareOriginalVsReplay } from "./replay.service.js";

describe("replay.service", () => {
  it("detects stricter replay decision", async () => {
    const out = await compareOriginalVsReplay({
      originalDecision: true,
      replayDecision: false,
      originalFindings: [],
      replayFindings: [{ ruleId: "R1" }],
    });
    expect(out.driftDetected).toBe(true);
    expect(out.driftClass).toBe("NEW_RISK_FOUND");
  });
});
