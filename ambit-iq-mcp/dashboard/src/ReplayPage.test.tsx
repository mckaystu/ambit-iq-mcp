import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReplayPage from "./ReplayPage";

describe("ReplayPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: "u", email: "u@x.com", tenant_id: null, roles: ["admin"], permissions: ["*"] } }),
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders heading", () => {
    render(
      <MemoryRouter>
        <ReplayPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /forensic replay/i })).toBeInTheDocument();
  });
});
