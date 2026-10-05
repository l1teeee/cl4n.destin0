import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const options = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    sendDefaultPii: false,
  };
  Sentry.init(options);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
