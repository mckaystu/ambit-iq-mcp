import { describe, expect, it } from "vitest";
import { evaluateThresholdAlerts, queueAlert, sendAlert } from "./alerting.service.js";

describe("alerting.service", () => {
  it("queues internal alert", async () => {
    const out = await queueAlert({
      type: "test_alert",
      severity: "high",
      title: "test",
      message: "msg",
    });
    expect(out.queued).toBe(true);
  });

  it("sendAlert returns envelope", async () => {
    const out = await sendAlert({
      type: "test_alert",
      severity: "high",
      title: "title",
      message: "body",
    });
    expect(typeof out.sent).toBe("boolean");
  });

  it("evaluateThresholdAlerts returns counters", async () => {
    const out = await evaluateThresholdAlerts();
    expect(typeof out.evaluated).toBe("number");
  });
});
