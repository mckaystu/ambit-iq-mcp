import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentInteractionsPage from "./AgentInteractionsPage";
import ExecutiveDashboardPage from "./ExecutiveDashboardPage";
import IncidentsPage from "./IncidentsPage";
import ModelGovernancePage from "./ModelGovernancePage";

describe("Phase 3 dashboard pages", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ExecutiveDashboardPage renders heading", () => {
    render(
      <MemoryRouter>
        <ExecutiveDashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /executive dashboard/i })).toBeInTheDocument();
  });

  it("ModelGovernancePage renders heading", () => {
    render(
      <MemoryRouter>
        <ModelGovernancePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /model governance/i })).toBeInTheDocument();
  });

  it("IncidentsPage renders heading", () => {
    render(
      <MemoryRouter>
        <IncidentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /incident response/i })).toBeInTheDocument();
  });

  it("AgentInteractionsPage renders heading", () => {
    render(
      <MemoryRouter>
        <AgentInteractionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /agent interactions/i })).toBeInTheDocument();
  });
});
