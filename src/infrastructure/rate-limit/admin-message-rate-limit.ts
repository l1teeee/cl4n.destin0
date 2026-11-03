import { consume } from "./postgres-rate-limiter";

export function consumeAdminMessageRateLimit(adminId: string) {
  return consume({ scope: "admin-message:send", subject: adminId, limit: 60, windowSeconds: 600 });
}
