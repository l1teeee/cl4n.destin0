export type InstagramConnectionKind = "INSTAGRAM_LOGIN" | "UNIFIED_LOGIN";

export interface InstagramConnection {
  accountId: string;
  username: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
  kind: InstagramConnectionKind;
  tokenVersion: number;
  connectedAt: Date;
  tokenRefreshedAt: Date;
  connectedByAdminId: string | null;
}

export interface InstagramConnectionRepository {
  find(): Promise<InstagramConnection | null>;
  findTokenExpiry(): Promise<{ expiresAt: Date | null } | null>;
  save(input: {
    accountId: string;
    username: string;
    accessToken: string;
    tokenExpiresAt: Date | null;
    kind: InstagramConnectionKind;
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

export interface UnifiedLoginClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<string>;
  inspectToken(accessToken: string): Promise<{ scopes: string[]; expiresAt: Date | null }>;
  listAccounts(accessToken: string): Promise<Array<{ accountId: string; username: string }>>;
  subscribeWebhooks(accessToken: string, accountId: string): Promise<void>;
}

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
