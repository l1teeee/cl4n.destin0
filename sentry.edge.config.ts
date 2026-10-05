import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  const options = {
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
  };
  Sentry.init(options);
}
