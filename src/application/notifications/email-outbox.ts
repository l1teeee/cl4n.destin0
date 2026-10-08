import type { EmailRecipient } from "@/application/ports/email-sender";

export const emailOutboxKinds = [
  "RESERVATION_CONFIRMED",
  "RESERVATION_WAITLISTED",
  "WAITLIST_PROMOTED",
  "RESERVATION_CANCELLED",
  "WAITLIST_CANCELLED",
  "ADMIN_ADDED",
  "ADMIN_SIGNED_IN",
  "ADMIN_PASSWORD_RESET_BY_ADMIN",
  "ADMIN_PASSWORD_CHANGED",
  "ADMIN_PASSWORD_RESET_COMPLETED",
  "ADMIN_DEACTIVATED",
  "ADMIN_REACTIVATED",
  "ADMIN_ROLE_CHANGED",
  "ADMIN_DELETED",
  "ADMIN_SESSIONS_REVOKED",
] as const;

export type EmailOutboxKind = (typeof emailOutboxKinds)[number];
export type EmailOutboxStatus = "PENDING" | "SENT" | "FAILED";

export interface EmailOutboxRow {
  id: string;
  kind: EmailOutboxKind;
  reservationId: string | null;
  waitlistEntryId: string | null;
  adminUserId: string | null;
  payload: Record<string, unknown>;
  status: EmailOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface RecentEmailOutboxItem {
  id: string;
  kind: EmailOutboxKind;
  status: EmailOutboxStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  nextAttemptAt: Date;
  recipientEmail: string;
}

export interface EmailOutboxRepository {
  claimDue(limit: number): Promise<EmailOutboxRow[]>;
  markSent(id: string): Promise<void>;
  scheduleRetry(id: string, delaySeconds: number, errorCode: string): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
  listRecent(input: {
    limit: number;
    status?: EmailOutboxStatus;
    kind?: EmailOutboxKind;
  }): Promise<RecentEmailOutboxItem[]>;
  countByStatusSince(days: number): Promise<Record<EmailOutboxStatus, number>>;
  retry(id: string): Promise<boolean>;
  deleteSentOlderThan(days: number): Promise<number>;
}

export interface ComposedOutboxEmail {
  to: EmailRecipient;
  rendered: {
    subject: string;
    html: string;
    text: string;
  };
}

export interface OutboxEmailComposer {
  compose(row: EmailOutboxRow): Promise<ComposedOutboxEmail | null>;
}
