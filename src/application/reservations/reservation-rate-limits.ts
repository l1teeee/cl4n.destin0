export const RESERVATION_IP_RATE_LIMIT = {
  scope: "reservation:ip",
  limit: 120,
  windowSeconds: 60,
} as const;

export const RESERVATION_INSTAGRAM_RATE_LIMIT = {
  scope: "reservation:instagram",
  limit: 5,
  windowSeconds: 600,
} as const;
