export interface TenantAwareUser {
  id: string;
  email?: string;
  tenant_id?: string | null;
  roles?: string[];
  permissions?: string[];
}

export function resolveTenant(user: TenantAwareUser | null | undefined): string | null {
  const tid = String(user?.tenant_id || "").trim();
  return tid || null;
}

export function canAccessTenant(
  user: TenantAwareUser | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  const roles = new Set((user?.roles || []).map((r) => String(r).toLowerCase()));
  if (roles.has("admin")) return true;
  const own = resolveTenant(user);
  if (!tenantId) return false;
  return Boolean(own && own === tenantId);
}

export function applyTenantScope<T extends Record<string, unknown>>(
  query: T,
  user: TenantAwareUser | null | undefined,
): T {
  const roles = new Set((user?.roles || []).map((r) => String(r).toLowerCase()));
  if (roles.has("admin")) return query;
  const tenantId = resolveTenant(user);
  if (!tenantId) return query;
  return {
    ...query,
    where: {
      ...(typeof query.where === "object" && query.where ? (query.where as Record<string, unknown>) : {}),
      tenantId,
    },
  };
}
