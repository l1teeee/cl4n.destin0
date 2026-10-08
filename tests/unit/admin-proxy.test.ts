import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, proxy } from "@/proxy";

describe("content security policy", () => {
  it("builds the production policy with only the configured Sentry origin", () => {
    expect(
      buildContentSecurityPolicy({
        appEnvironment: "production",
        nonce: "production-nonce",
        sentryDsn: "https://public-key@o123.ingest.sentry.io/456",
      }),
    ).toBe(
      "default-src 'self'; script-src 'self' 'nonce-production-nonce' 'strict-dynamic' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://o123.ingest.sentry.io; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it("adds unsafe-eval only for local development", () => {
    const local = buildContentSecurityPolicy({ appEnvironment: "local", nonce: "local-nonce" });
    const preview = buildContentSecurityPolicy({
      appEnvironment: "preview",
      nonce: "preview-nonce",
    });

    expect(local).toContain("'unsafe-eval'");
    expect(preview).not.toContain("'unsafe-eval'");
  });
});

describe("admin proxy", () => {
  it("redirects /admin without a session cookie", () => {
    const response = proxy(new NextRequest("http://localhost/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/admin/login");
  });

  it("guards event CSV exports without a session cookie", () => {
    const response = proxy(
      new NextRequest("http://localhost/admin/events/00000000-0000-4000-8000-000000000001/export"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/admin/login");
  });

  it("allows the login page without a session cookie", () => {
    const response = proxy(new NextRequest("http://localhost/admin/login"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/admin/forgot", "/admin/reset"])("allows %s without a session cookie", (pathname) => {
    const response = proxy(new NextRequest(`http://localhost${pathname}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sets a fresh nonce CSP on public responses and forwarded requests", () => {
    const first = proxy(new NextRequest("http://localhost/solicitar/cena"));
    const second = proxy(new NextRequest("http://localhost/solicitar/cena"));
    const firstPolicy = first.headers.get("Content-Security-Policy");
    const secondPolicy = second.headers.get("Content-Security-Policy");

    expect(firstPolicy).toContain("'strict-dynamic'");
    expect(firstPolicy).toMatch(/'nonce-[^']+'/);
    expect(secondPolicy).toMatch(/'nonce-[^']+'/);
    expect(secondPolicy).not.toBe(firstPolicy);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it.each(["cl4n_session", "__Host-cl4n_session"])("optimistically allows %s", (name) => {
    const request = new NextRequest("http://localhost/admin/events", {
      headers: { cookie: `${name}=opaque-token` },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
