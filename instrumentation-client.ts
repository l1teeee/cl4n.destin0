import * as Sentry from "@sentry/nextjs";

import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from "@/infrastructure/observability/sentry-scrubbing";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const options = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dataCollection: { httpBodies: [], userInfo: false, cookies: false },
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSend: scrubSentryEvent,
  };
  Sentry.init(options);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
