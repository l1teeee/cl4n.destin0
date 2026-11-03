export function mapProviderOf(value: string): "GOOGLE_MAPS" | "WAZE" | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host === "waze.com" || host === "www.waze.com" || host === "ul.waze.com") {
    return "WAZE";
  }
  if (host === "maps.app.goo.gl" || /^maps\.google\.(?:[a-z]+|(?:com|co)\.[a-z]{2})$/.test(host)) {
    return "GOOGLE_MAPS";
  }
  if (
    (host === "goo.gl" || /^(?:www\.)?google\.(?:[a-z]+|(?:com|co)\.[a-z]{2})$/.test(host)) &&
    url.pathname.startsWith("/maps")
  ) {
    return "GOOGLE_MAPS";
  }
  return null;
}
