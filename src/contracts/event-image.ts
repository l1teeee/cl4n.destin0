export const MAX_EVENT_IMAGES = 6;

export function isEventImagePublicToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
