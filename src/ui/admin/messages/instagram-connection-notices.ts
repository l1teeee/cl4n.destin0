export const instagramConnectionNotices = [
  "connected",
  "cancelled",
  "failed",
  "invalid_state",
  "wrong_account",
  "missing_permission",
  "subscribe_failed",
  "no_account",
  "multiple_accounts",
  "forbidden",
] as const;

export type InstagramConnectionNotice = (typeof instagramConnectionNotices)[number];
