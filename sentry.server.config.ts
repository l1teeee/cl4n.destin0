import * as Sentry from "@sentry/nextjs";

import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from "@/infrastructure/observability/sentry-scrubbing";

if (process.env.SENTRY_DSN) {
  const options = {
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSend: scrubSentryEvent,
  };
  Sentry.init(options);
}
