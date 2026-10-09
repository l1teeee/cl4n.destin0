import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ServerEnv } from "@/infrastructure/config/env";
import { env } from "@/infrastructure/config/env";

const publicAdminPaths = new Set(["/admin/login", "/admin/forgot", "/admin/reset"]);
const protectedCookieNames = ["cl4n_session", "__Host-cl4n_session"];

interface ContentSecurityPolicyOptions {
  appEnvironment: ServerEnv["APP_ENV"];
  nonce: string;
  sentryDsn?: string;
  allowAdminMaps?: boolean;
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const sentryOrigin = options.sentryDsn ? new URL(options.sentryDsn).origin : undefined;
  const localScriptSource = options.appEnvironment === "local" ? " 'unsafe-eval'" : "";
  const sentryConnectSource = sentryOrigin ? ` ${sentryOrigin}` : "";
  const mapsFrameSource = options.allowAdminMaps ? " https://www.google.com" : "";

  // WHY: the Turnstile component sets inline container dimensions through React style props.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic' https://challenges.cloudflare.com${localScriptSource}`,
    `frame-src https://challenges.cloudflare.com${mapsFrameSource}`,
    `connect-src 'self'${sentryConnectSource}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function nextResponse(request: NextRequest, requestHeaders: Headers): NextResponse {
  if (request.nextUrl.pathname.startsWith("/admin")) {
    const isPublicAdminPage = publicAdminPaths.has(request.nextUrl.pathname);
    const hasSessionCookie = protectedCookieNames.some((name) => request.cookies.has(name));
    if (!isPublicAdminPage && !hasSessionCookie) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const browserSentryDsn = env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN;
  const contentSecurityPolicy = buildContentSecurityPolicy({
    appEnvironment: env.APP_ENV,
    nonce,
    allowAdminMaps: request.nextUrl.pathname.startsWith("/admin"),
    ...(browserSentryDsn ? { sentryDsn: browserSentryDsn } : {}),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = nextResponse(request, requestHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

// WHY: files served from public/ need neither the per-request CSP nonce nor the admin redirect, and
// next.config.ts adds the static security headers to every path anyway. Skipping them avoids one
// proxy invocation per asset during reservation traffic spikes. A new public file type has to be
// added to the extension list to be skipped as well.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|fonts/|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:png|jpe?g|svg|webp|ico|woff2|txt)$).*)",
  ],
};
