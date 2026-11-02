// Blank means not configured. A leading @ is dropped so profile and chat links stay valid.
export function configuredInstagramUsername(): string | undefined {
  const username = process.env.NEXT_PUBLIC_INSTAGRAM_USERNAME?.trim().replace(/^@/, "");
  return username ? username : undefined;
}

export function instagramProfileUrl(username: string): string {
  return `https://instagram.com/${encodeURIComponent(username)}`;
}
