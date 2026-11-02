import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requirePermission } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { completeConfiguredInstagramConnection } from "@/infrastructure/instagram/instagram-connection-runtime";
import { log } from "@/infrastructure/observability/logger";

export const dynamic = "force-dynamic";

function responseFor(path: string | null): Response {
  const response =
    path === null
      ? new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } })
      : NextResponse.redirect(new URL(path, env.APP_BASE_URL), {
          status: 302,
          headers: { "Cache-Control": "no-store" },
        });
  response.cookies.set("cl4n_ig_oauth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/instagram/callback",
    maxAge: 0,
    secure: env.APP_BASE_URL.startsWith("https"),
  });
  return response;
}

function notice(value: string): Response {
  return responseFor(`/admin/account?instagram=${value}`);
}

export async function GET(request: Request): Promise<Response> {
  const cookie = (await cookies()).get("cl4n_ig_oauth_state")?.value;
  if (env.MESSAGING_MODE === "log") return responseFor(null);
  const authorization = await requirePermission("instagram.connect", "action");
  if (!authorization.authorized) {
    return authorization.error === "UNAUTHORIZED"
      ? responseFor("/admin/login")
      : notice("forbidden");
  }
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  if (!state || !cookie) return notice("invalid_state");
  const supplied = Buffer.from(state);
  const expected = Buffer.from(cookie);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return notice("invalid_state");
  }
  if (params.has("error")) return notice("cancelled");
  const code = params.get("code");
  if (!code) return notice("failed");
  const result = await completeConfiguredInstagramConnection(code, authorization.session.admin.id);
  if (result.ok) {
    log("info", "instagram_connected", { username: result.username });
    return notice("connected");
  }
  log("warn", "instagram_connect_failed", { reason: result.error });
  const notices = {
    TOKEN_EXCHANGE_FAILED: "failed",
    MISSING_PERMISSION: "missing_permission",
    WRONG_ACCOUNT: "wrong_account",
    SUBSCRIBE_FAILED: "subscribe_failed",
  } as const;
  return notice(notices[result.error]);
}
