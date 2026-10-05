import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const protectedCookieNames = ["cl4n_session", "__Host-cl4n_session"];

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const hasSessionCookie = protectedCookieNames.some((name) => request.cookies.has(name));
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
