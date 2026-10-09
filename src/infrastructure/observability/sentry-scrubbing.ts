import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const QUERY_TOKEN = /([?&]token=)[^&#]*/gi;
const FRAGMENT_TOKEN = /(#token=)[^&]*/gi;
const REDACTED = "[Filtered]";

const LOCATION_PHOTO_TOKEN = /(\/ubicacion\/foto\/)[^/?#]*/gi;

export function scrubTokenFromUrl(url: string): string {
  return url
    .replace(QUERY_TOKEN, `$1${REDACTED}`)
    .replace(FRAGMENT_TOKEN, `$1${REDACTED}`)
    .replace(LOCATION_PHOTO_TOKEN, "$1[redacted]");
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

const SENSITIVE_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);

function withoutSensitiveHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase())),
  );
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = {
    ...event,
    breadcrumbs: event.breadcrumbs?.map(scrubSentryBreadcrumb),
  };

  if (event.request) {
    const request = { ...event.request };
    // Reservation bodies carry names, phones, emails and allergy data.
    delete request.data;
    delete request.cookies;
    scrubbed.request = {
      ...request,
      url: typeof request.url === "string" ? scrubTokenFromUrl(request.url) : request.url,
      headers: withoutSensitiveHeaders(request.headers),
    };
  }

  if (event.user) {
    const user = { ...event.user };
    delete user.ip_address;
    scrubbed.user = user;
  }

  return scrubbed;
}
