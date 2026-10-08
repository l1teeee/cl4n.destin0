export interface AdminUserNotifications {
  sendDeletionCode(input: {
    to: { email: string; name: string };
    actorDisplayName: string;
    targetDisplayName: string;
    targetEmail: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<void>;
}
