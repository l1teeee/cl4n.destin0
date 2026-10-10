import type { MapsLinkResolver } from "@/application/events/maps-link-resolver";
import { isAllowedGoogleMapsUrl } from "@/contracts/admin-event";
import { log } from "@/infrastructure/observability/logger";

const MAX_REDIRECT_HOPS = 5;
const EXPANSION_TIMEOUT_MS = 4000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isShortMapsLink(value: string): boolean {
  if (!isAllowedGoogleMapsUrl(value)) return false;
  const url = new URL(value);
  return url.hostname === "maps.app.goo.gl" || url.hostname === "goo.gl";
}

export class GoogleMapsLinkResolver implements MapsLinkResolver {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async expand(startUrl: string): Promise<string | null> {
    if (!isShortMapsLink(startUrl)) return null;

    const signal = AbortSignal.timeout(EXPANSION_TIMEOUT_MS);
    let currentUrl = startUrl;
    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
        const response = await this.fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal,
        });
        // The body is never read; cancelling only releases the connection.
        await response.body?.cancel();

        if (!REDIRECT_STATUSES.has(response.status)) return currentUrl;

        const location = response.headers.get("location");
        if (location === null) return this.reject(currentUrl, "redirect without location");
        const nextUrl = new URL(location, currentUrl).href;
        if (!isAllowedGoogleMapsUrl(nextUrl)) return this.reject(nextUrl, "host not allowed");
        currentUrl = nextUrl;
      }
      return this.reject(currentUrl, "too many redirects");
    } catch {
      return this.reject(currentUrl, "request failed");
    }
  }

  private reject(url: string, reason: string): null {
    log("warn", "maps short link expansion failed", { reason, host: safeHost(url) });
    return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const googleMapsLinkResolver = new GoogleMapsLinkResolver();
