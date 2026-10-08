import type { AdminUserNotifications } from "@/application/admin-users/admin-user-notifications";

import { emailSender } from "./email-sender";
import { adminDeletionCodeEmail } from "./templates/admin-deletion-code-email";

export const adminUserNotifications: AdminUserNotifications = {
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
