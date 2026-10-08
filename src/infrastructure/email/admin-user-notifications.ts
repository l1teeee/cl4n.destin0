import type { AdminUserNotifications } from "@/application/admin-users/admin-user-notifications";
import { env } from "@/infrastructure/config/env";

import { emailSender } from "./email-sender";
import { adminAddedEmail } from "./templates/admin-added-email";
import { adminDeletionCodeEmail } from "./templates/admin-deletion-code-email";

export const adminUserNotifications: AdminUserNotifications = {
  async sendAdminAdded(input) {
    const rendered = adminAddedEmail({
      displayName: input.displayName,
      role: input.role,
      addedByDisplayName: input.addedByDisplayName,
      loginUrl: `${env.APP_BASE_URL}/admin/login`,
    });
    await emailSender.send({ to: input.to, ...rendered });
  },

  async sendDeletionCode(input) {
    const rendered = adminDeletionCodeEmail({
      actorDisplayName: input.actorDisplayName,
      targetDisplayName: input.targetDisplayName,
      targetEmail: input.targetEmail,
      code: input.code,
      expiresInMinutes: input.expiresInMinutes,
    });
    await emailSender.send({ to: input.to, ...rendered });
  },
};
