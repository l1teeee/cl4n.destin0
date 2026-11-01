function withoutTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function locationPhotoUrl(appBaseUrl: string, publicToken: string): string {
  return `${withoutTrailingSlash(appBaseUrl)}/ubicacion/foto/${publicToken}`;
}

export function clueImageUrl(appBaseUrl: string, slug: string, imageId: string): string {
  const base = withoutTrailingSlash(appBaseUrl);
  return `${base}/pistas/${encodeURIComponent(slug)}/imagenes/${encodeURIComponent(imageId)}`;
}
