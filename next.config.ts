import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: false,
    workerThreads: true,
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
