const MESSAGING_WINDOW_MS = (24 * 60 - 5) * 60 * 1000;

export function isMessagingWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < MESSAGING_WINDOW_MS;
}
