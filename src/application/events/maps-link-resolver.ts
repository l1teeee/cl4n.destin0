export interface MapsLinkResolver {
  // Returns the full Maps URL a short link points to, or null when it cannot be expanded safely.
  expand(url: string): Promise<string | null>;
}
