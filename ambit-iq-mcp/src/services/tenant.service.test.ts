import { describe, expect, it } from "vitest";
import { applyTenantScope, canAccessTenant, resolveTenant } from "./tenant.service.js";

describe("tenant.service", () => {
  it("resolveTenant returns tenant id", () => {
    expect(resolveTenant({ id: "u", tenant_id: "t1" })).toBe("t1");
  });

  it("canAccessTenant allows admin override", () => {
    expect(canAccessTenant({ id: "u", tenant_id: "t1", roles: ["admin"] }, "t2")).toBe(true);
  });

  it("applyTenantScope adds tenant for non-admin", () => {
    const scoped = applyTenantScope({ where: { status: "open" } }, { id: "u", tenant_id: "t1", roles: ["auditor"] });
    expect((scoped.where as Record<string, unknown>).tenantId).toBe("t1");
  });
});
