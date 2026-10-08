import type { AdminRole } from "@/domain/admin/admin-access";

export interface AdminUserNotifications {
  sendAdminAdded(input: {
    to: { email: string; name: string };
    displayName: string;
    role: AdminRole;
    addedByDisplayName: string;
  }): Promise<void>;
  sendDeletionCode(input: {
    to: { email: string; name: string };
    actorDisplayName: string;
    targetDisplayName: string;
    targetEmail: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<void>;
}
