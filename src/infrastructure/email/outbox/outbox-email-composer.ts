import type { Pool, QueryResultRow } from "pg";

import type {
  ComposedOutboxEmail,
  EmailOutboxRow,
  OutboxEmailComposer,
} from "@/application/notifications/email-outbox";
import { isRetiredGuestEmailKind } from "@/application/notifications/email-outbox";
import { PermanentEmailCompositionError } from "@/application/notifications/email-delivery-error";
import type { AdminRole } from "@/domain/admin/admin-access";

import { env } from "../../config/env";
import { pool as applicationPool } from "../../db/client";
import type { AdminAccountNotice } from "../templates/admin-account-notice-email";
import { adminAccountNoticeEmail } from "../templates/admin-account-notice-email";
import { adminAddedEmail } from "../templates/admin-added-email";
import { adminSignInAlertEmail } from "../templates/admin-sign-in-alert-email";

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

function payloadAdminRole(row: EmailOutboxRow): AdminRole {
  const value = payloadString(row, "role");
  if (value !== "SUPER_ADMIN" && value !== "ADMIN") {
    throw new Error(`Outbox payload role is invalid for ${row.kind}`);
  }
  return value;
}

export class PostgresOutboxEmailComposer implements OutboxEmailComposer {
  constructor(private readonly pool: Pool = applicationPool) {}

  async compose(row: EmailOutboxRow): Promise<ComposedOutboxEmail | null> {
    if (isRetiredGuestEmailKind(row.kind)) {
      throw new PermanentEmailCompositionError("KIND_RETIRED");
    }
    if (!row.adminUserId) {
      throw new Error(`Outbox row ${row.id} has no subject`);
    }
    return this.composeForAdmin(row, row.adminUserId);
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
