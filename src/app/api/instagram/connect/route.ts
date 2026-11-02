import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requirePermission } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { instagramAuthorizationUrl } from "@/infrastructure/instagram/instagram-connection-runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (env.MESSAGING_MODE === "log") {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const authorization = await requirePermission("instagram.connect", "action");
  if (!authorization.authorized) {
    const path =
      authorization.error === "UNAUTHORIZED"
        ? "/admin/login"
        : "/admin/account?instagram=forbidden";
    return NextResponse.redirect(new URL(path, env.APP_BASE_URL), {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(instagramAuthorizationUrl(state), {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set("cl4n_ig_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/instagram/callback",
    maxAge: 600,
    secure: env.APP_BASE_URL.startsWith("https"),
  });
  return response;
}
