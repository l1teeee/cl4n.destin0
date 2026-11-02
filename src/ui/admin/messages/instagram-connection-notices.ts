export const instagramConnectionNotices = [
  "connected",
  "cancelled",
  "failed",
  "invalid_state",
  "wrong_account",
  "missing_permission",
  "subscribe_failed",
  "forbidden",
] as const;

export type InstagramConnectionNotice = (typeof instagramConnectionNotices)[number];
