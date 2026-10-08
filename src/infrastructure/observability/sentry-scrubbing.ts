import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const QUERY_TOKEN = /([?&]token=)[^&#]*/gi;
const FRAGMENT_TOKEN = /(#token=)[^&]*/gi;
const REDACTED = "[Filtered]";

export function scrubTokenFromUrl(url: string): string {
  return url.replace(QUERY_TOKEN, `$1${REDACTED}`).replace(FRAGMENT_TOKEN, `$1${REDACTED}`);
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data) {
    return breadcrumb;
  }

  const data = { ...breadcrumb.data };
  for (const field of ["from", "to", "url"] as const) {
    if (typeof data[field] === "string") {
      data[field] = scrubTokenFromUrl(data[field]);
    }
  }
  return { ...breadcrumb, data };
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  return {
    ...event,
    breadcrumbs: event.breadcrumbs?.map(scrubSentryBreadcrumb),
    request: event.request
      ? {
          ...event.request,
          url:
            typeof event.request.url === "string"
              ? scrubTokenFromUrl(event.request.url)
              : event.request.url,
        }
      : event.request,
  };
}
