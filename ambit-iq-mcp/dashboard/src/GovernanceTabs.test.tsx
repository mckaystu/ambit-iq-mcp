import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GovernanceTabs from "./components/GovernanceTabs";

describe("GovernanceTabs auth visibility", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            id: "u",
            email: "dev@example.com",
            tenant_id: "t1",
            roles: ["developer"],
            permissions: ["view.executive"],
          },
        }),
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("hides unauthorized links", async () => {
    render(
      <MemoryRouter>
        <GovernanceTabs />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByText("Policy IDE")).not.toBeInTheDocument());
  });
});
