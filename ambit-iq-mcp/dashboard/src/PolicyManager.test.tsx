import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PolicyManager from "./PolicyManager";

describe("PolicyManager", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, viml_preview: { vibe_intent: "unit" } }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables Validate on server when VIML is empty", () => {
    render(<PolicyManager />);
    expect(screen.getByRole("button", { name: /validate on server/i })).toBeDisabled();
  });

  it("enables Validate after VIML input and POSTs viml-preview", async () => {
    const user = userEvent.setup();
    render(<PolicyManager />);
    const viml = screen.getAllByTestId("policy-editor-viml")[0];
    await user.type(viml, "vibe:\n  intent: test\n");
    await waitFor(() => {
      const validateBtns = screen.getAllByRole("button", { name: /validate on server/i });
      expect(validateBtns.some((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    });
    const enabledValidate = screen
      .getAllByRole("button", { name: /validate on server/i })
      .find((b) => !(b as HTMLButtonElement).disabled);
    expect(enabledValidate).toBeTruthy();
    await user.click(enabledValidate!);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ action: "viml-preview", viml: expect.stringContaining("vibe:") });
  });
});
