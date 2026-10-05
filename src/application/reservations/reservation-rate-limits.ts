export const RESERVATION_IP_RATE_LIMIT = {
  scope: "reservation:ip",
  limit: 120,
  windowSeconds: 60,
} as const;

export const RESERVATION_EMAIL_RATE_LIMIT = {
  scope: "reservation:email",
  limit: 5,
  windowSeconds: 600,
} as const;

export const RESERVATION_PHONE_RATE_LIMIT = {
  scope: "reservation:phone",
  limit: 5,
  windowSeconds: 600,
} as const;
