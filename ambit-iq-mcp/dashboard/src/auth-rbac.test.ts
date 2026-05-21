import { describe, expect, it } from "vitest";
// @ts-expect-error JS API helper has no TS declarations.
import { hasPermission } from "../api/_auth.js";

describe("auth rbac", () => {
  it("admin wildcard passes", () => {
    expect(hasPermission({ permissions: ["*"] }, "manage.users")).toBe(true);
  });

  it("missing permission fails", () => {
    expect(hasPermission({ permissions: ["view.executive"] }, "manage.policies")).toBe(false);
  });
});
