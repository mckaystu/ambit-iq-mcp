import { describe, expect, it } from "vitest";
import { exportCsv, exportHtmlReport, exportJson } from "./export.service.js";

describe("export.service", () => {
  it("returns csv envelope", async () => {
    const out = await exportCsv("incidents");
    expect(out.format).toBe("csv");
    expect(typeof out.content).toBe("string");
  });

  it("returns json envelope", async () => {
    const out = await exportJson("evidence-bundle");
    expect(out.format).toBe("json");
    expect(Array.isArray(out.content)).toBe(true);
  });

  it("returns html report envelope", async () => {
    const out = await exportHtmlReport("executive-board");
    expect(out.format).toBe("html");
    expect(String(out.content)).toContain("<html>");
  });
});
