import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

if (process.env.APP_ENV === "preview" || process.env.APP_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    useTypeScriptCli: false,
    workerThreads: true,
    serverActions: {
      bodySizeLimit: "64kb",
    },
  },
  headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // WHY: the reset link carries a secret, so no referrer may be sent from that page.
      { source: "/admin/reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
