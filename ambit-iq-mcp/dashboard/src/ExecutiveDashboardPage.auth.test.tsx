import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExecutiveDashboardPage from "./ExecutiveDashboardPage";

describe("ExecutiveDashboardPage export auth", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("/api/me")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              user: {
                id: "u",
                email: "auditor@example.com",
                tenant_id: "t1",
                roles: ["auditor"],
                permissions: ["view.executive"],
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("hides export button without export permission", async () => {
    render(
      <MemoryRouter>
        <ExecutiveDashboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /export report/i })).not.toBeInTheDocument());
  });
});
