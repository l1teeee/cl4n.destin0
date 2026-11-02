export interface InstagramConnection {
  accountId: string;
  username: string;
  accessToken: string;
  tokenExpiresAt: Date;
  tokenVersion: number;
  connectedAt: Date;
  tokenRefreshedAt: Date;
  connectedByAdminId: string | null;
}

export interface InstagramConnectionRepository {
  find(): Promise<InstagramConnection | null>;
  save(input: {
    accountId: string;
    username: string;
    accessToken: string;
    tokenExpiresAt: Date;
    adminId: string;
  }): Promise<void>;
  replaceToken(input: {
    expectedVersion: number;
    accessToken: string;
    tokenExpiresAt: Date;
  }): Promise<boolean>;
  delete(adminId: string): Promise<boolean>;
}

export class InstagramOAuthError extends Error {}

export interface InstagramOAuthClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{ shortLivedToken: string; permissions: string[] }>;
  exchangeLongLivedToken(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number }>;
  fetchAccount(accessToken: string): Promise<{ accountId: string; username: string }>;
  subscribeWebhooks(accessToken: string): Promise<void>;
  refreshToken(accessToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>;
}
