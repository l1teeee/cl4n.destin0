import type { Pool, QueryResultRow } from "pg";

import type {
  ComposedOutboxEmail,
  EmailOutboxRow,
  OutboxEmailComposer,
} from "@/application/notifications/email-outbox";
import type { AdminRole } from "@/domain/admin/admin-access";

import { env } from "../../config/env";
import { pool as applicationPool } from "../../db/client";
import type { AdminAccountNotice } from "../templates/admin-account-notice-email";
import { adminAccountNoticeEmail } from "../templates/admin-account-notice-email";
import { adminAddedEmail } from "../templates/admin-added-email";
import { adminSignInAlertEmail } from "../templates/admin-sign-in-alert-email";
import { reservationCancelledEmail } from "../templates/reservation-cancelled-email";
import { reservationConfirmationEmail } from "../templates/reservation-confirmation-email";
import { reservationWaitlistedEmail } from "../templates/reservation-waitlisted-email";
import { waitlistPromotedEmail } from "../templates/waitlist-promoted-email";

interface GuestRecord extends QueryResultRow {
  email: string;
  full_name: string;
  party_size: number;
  starts_at: Date;
  reservation_number: number | null;
}

interface AdminRecord extends QueryResultRow {
  email: string;
  display_name: string;
  role: AdminRole;
}

const adminNoticeByKind: Partial<Record<EmailOutboxRow["kind"], AdminAccountNotice>> = {
  ADMIN_PASSWORD_RESET_BY_ADMIN: "PASSWORD_RESET_BY_ADMIN",
  ADMIN_PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ADMIN_PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  ADMIN_DEACTIVATED: "DEACTIVATED",
  ADMIN_REACTIVATED: "REACTIVATED",
  ADMIN_ROLE_CHANGED: "ROLE_CHANGED",
  ADMIN_DELETED: "DELETED",
  ADMIN_SESSIONS_REVOKED: "SESSIONS_REVOKED",
};

function payloadString(row: EmailOutboxRow, field: string): string {
  const value = row.payload[field];
  if (typeof value !== "string") {
    throw new Error(`Outbox payload field ${field} is missing for ${row.kind}`);
  }
  return value;
}

function payloadPosition(row: EmailOutboxRow): number {
  const value = row.payload.position;
  if (typeof value !== "number") {
    throw new Error(`Outbox payload field position is missing for ${row.kind}`);
  }
  return value;
}

function payloadAdminRole(row: EmailOutboxRow): AdminRole {
  const value = payloadString(row, "role");
  if (value !== "SUPER_ADMIN" && value !== "ADMIN") {
    throw new Error(`Outbox payload role is invalid for ${row.kind}`);
  }
  return value;
}

function requireReservationNumber(row: EmailOutboxRow, guest: GuestRecord): number {
  if (guest.reservation_number === null) {
    throw new Error(`Reservation number is missing for ${row.kind}`);
  }
  return guest.reservation_number;
}

export class PostgresOutboxEmailComposer implements OutboxEmailComposer {
  constructor(private readonly pool: Pool = applicationPool) {}

  async compose(row: EmailOutboxRow): Promise<ComposedOutboxEmail | null> {
    if (row.reservationId) {
      return this.composeForReservation(row, row.reservationId);
    }
    if (row.waitlistEntryId) {
      return this.composeForWaitlistEntry(row, row.waitlistEntryId);
    }
    if (row.adminUserId) {
      return this.composeForAdmin(row, row.adminUserId);
    }
    throw new Error(`Outbox row ${row.id} has no subject`);
  }

  private async composeForReservation(
    row: EmailOutboxRow,
    reservationId: string,
  ): Promise<ComposedOutboxEmail | null> {
    const result = await this.pool.query<GuestRecord>(
      `SELECT r.email, r.full_name, r.party_size, e.starts_at, r.reservation_number
         FROM reservations r
         JOIN events e ON e.id = r.event_id
        WHERE r.id = $1`,
      [reservationId],
    );
    const guest = result.rows[0];
    if (!guest) {
      return null;
    }

    const to = { email: guest.email, name: guest.full_name };

    switch (row.kind) {
      case "RESERVATION_CONFIRMED":
        return {
          to,
          rendered: reservationConfirmationEmail({
            fullName: guest.full_name,
            reservationNumber: requireReservationNumber(row, guest),
            partySize: guest.party_size,
            eventStartsAt: guest.starts_at,
          }),
        };
      case "WAITLIST_PROMOTED":
        return {
          to,
          rendered: waitlistPromotedEmail({
            fullName: guest.full_name,
            reservationNumber: requireReservationNumber(row, guest),
            partySize: guest.party_size,
            eventStartsAt: guest.starts_at,
          }),
        };
      case "RESERVATION_CANCELLED":
        return {
          to,
          rendered: reservationCancelledEmail({
            fullName: guest.full_name,
            reservationNumber: guest.reservation_number,
            eventStartsAt: guest.starts_at,
          }),
        };
      default:
        throw new Error(`Outbox kind ${row.kind} cannot target a reservation`);
    }
  }

  private async composeForWaitlistEntry(
    row: EmailOutboxRow,
    waitlistEntryId: string,
  ): Promise<ComposedOutboxEmail | null> {
    // The promoted reservation supplies the number a promoted guest finally receives.
    const result = await this.pool.query<GuestRecord>(
      `SELECT w.email, w.full_name, w.party_size, e.starts_at, pr.reservation_number
         FROM waitlist_entries w
         JOIN events e ON e.id = w.event_id
         LEFT JOIN reservations pr ON pr.id = w.promoted_reservation_id
        WHERE w.id = $1`,
      [waitlistEntryId],
    );
    const guest = result.rows[0];
    if (!guest) {
      return null;
    }

    const to = { email: guest.email, name: guest.full_name };

    switch (row.kind) {
      case "RESERVATION_WAITLISTED":
        return {
          to,
          rendered: reservationWaitlistedEmail({
            fullName: guest.full_name,
            position: payloadPosition(row),
            partySize: guest.party_size,
            eventStartsAt: guest.starts_at,
          }),
        };
      case "WAITLIST_PROMOTED":
        return {
          to,
          rendered: waitlistPromotedEmail({
            fullName: guest.full_name,
            reservationNumber: requireReservationNumber(row, guest),
            partySize: guest.party_size,
            eventStartsAt: guest.starts_at,
          }),
        };
      case "WAITLIST_CANCELLED":
        return {
          to,
          rendered: reservationCancelledEmail({
            fullName: guest.full_name,
            reservationNumber: null,
            eventStartsAt: guest.starts_at,
          }),
        };
      default:
        throw new Error(`Outbox kind ${row.kind} cannot target a waitlist entry`);
    }
  }

  private async composeForAdmin(
    row: EmailOutboxRow,
    adminUserId: string,
  ): Promise<ComposedOutboxEmail | null> {
    // Soft-deleted rows are included so the ADMIN_DELETED notice can still be addressed.
    const result = await this.pool.query<AdminRecord>(
      "SELECT email, display_name, role FROM admin_users WHERE id = $1",
      [adminUserId],
    );
    const admin = result.rows[0];
    if (!admin) {
      return null;
    }

    const to = { email: admin.email, name: admin.display_name };
    const loginUrl = `${env.APP_BASE_URL}/admin/login`;

    if (row.kind === "ADMIN_ADDED") {
      return {
        to,
        rendered: adminAddedEmail({
          displayName: admin.display_name,
          role: admin.role,
          addedByDisplayName: payloadString(row, "addedByDisplayName"),
          loginUrl,
        }),
      };
    }

    if (row.kind === "ADMIN_SIGNED_IN") {
      const ipAddress = row.payload.ipAddress;
      return {
        to,
        rendered: adminSignInAlertEmail({
          displayName: admin.display_name,
          occurredAt: new Date(payloadString(row, "occurredAt")),
          ipAddress: typeof ipAddress === "string" ? ipAddress : null,
        }),
      };
    }

    const notice = adminNoticeByKind[row.kind];
    if (!notice) {
      throw new Error(`Outbox kind ${row.kind} cannot target an admin user`);
    }
    return {
      to,
      rendered: adminAccountNoticeEmail({
        displayName: admin.display_name,
        notice,
        ...(notice === "ROLE_CHANGED" ? { role: payloadAdminRole(row) } : {}),
        loginUrl,
      }),
    };
  }
}

export const postgresOutboxEmailComposer = new PostgresOutboxEmailComposer();
