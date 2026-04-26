import { NextResponse } from "next/server";

import { extractTokenFromRequest, getAdminCookieName, getConfiguredBearerToken, isValidAdminToken } from "@/lib/admin-auth";
import { getRequestRole, hasRole } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = extractTokenFromRequest(request);
  const role = getRequestRole(request);
  return NextResponse.json({
    authenticated: isValidAdminToken(token),
    configured: Boolean(getConfiguredBearerToken()),
    role,
    canAdmin: hasRole(role, "admin"),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string };
    if (!isValidAdminToken(body.token)) {
      return NextResponse.json({ error: "Invalid bearer token." }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(getAdminCookieName(), body.token ?? "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
