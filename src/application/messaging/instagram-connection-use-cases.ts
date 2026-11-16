import {
  InstagramOAuthError,
  type InstagramConnectionRepository,
  type InstagramOAuthClient,
  type UnifiedLoginClient,
} from "./instagram-connection";

interface Dependencies {
  oauth: InstagramOAuthClient;
  repository: InstagramConnectionRepository;
  now: () => Date;
}

type ConnectionResult =
  | { ok: true; username: string }
  | {
      ok: false;
      error:
        | "TOKEN_EXCHANGE_FAILED"
        | "MISSING_PERMISSION"
        | "WRONG_ACCOUNT"
        | "SUBSCRIBE_FAILED"
        | "NO_ACCOUNT"
        | "MULTIPLE_ACCOUNTS";
    };

export async function completeInstagramConnection(
  deps: Dependencies,
  input: { code: string; adminId: string; requiredUsername: string | null },
): Promise<ConnectionResult> {
  let token: { accessToken: string; expiresInSeconds: number };
  let account: { accountId: string; username: string };
  try {
    const exchanged = await deps.oauth.exchangeCode(input.code);
    if (!exchanged.permissions.includes("instagram_business_manage_messages")) {
      return { ok: false, error: "MISSING_PERMISSION" };
    }
    token = await deps.oauth.exchangeLongLivedToken(exchanged.shortLivedToken);
    account = await deps.oauth.fetchAccount(token.accessToken);
  } catch (error) {
    if (error instanceof InstagramOAuthError) return { ok: false, error: "TOKEN_EXCHANGE_FAILED" };
    throw error;
  }
  if (
    input.requiredUsername !== null &&
    account.username.toLowerCase() !== input.requiredUsername.toLowerCase()
  ) {
    return { ok: false, error: "WRONG_ACCOUNT" };
  }
  try {
    await deps.oauth.subscribeWebhooks(token.accessToken);
  } catch (error) {
    if (error instanceof InstagramOAuthError) return { ok: false, error: "SUBSCRIBE_FAILED" };
    throw error;
  }
  await deps.repository.save({
    ...account,
    accessToken: token.accessToken,
    tokenExpiresAt: new Date(deps.now().getTime() + token.expiresInSeconds * 1000),
    kind: "INSTAGRAM_LOGIN",
    adminId: input.adminId,
  });
  return { ok: true, username: account.username };
}

export async function completeUnifiedInstagramConnection(
  deps: { client: UnifiedLoginClient; repository: InstagramConnectionRepository },
  input: { code: string; adminId: string; requiredUsername: string | null },
): Promise<ConnectionResult> {
  let token: string;
  let inspection: { scopes: string[]; expiresAt: Date | null };
  let accounts: Array<{ accountId: string; username: string }>;
  try {
    token = await deps.client.exchangeCode(input.code);
    inspection = await deps.client.inspectToken(token);
    accounts = await deps.client.listAccounts(token);
  } catch (error) {
    if (error instanceof InstagramOAuthError) return { ok: false, error: "TOKEN_EXCHANGE_FAILED" };
    throw error;
  }
  if (
    !inspection.scopes.includes("instagram_basic") ||
    !inspection.scopes.includes("instagram_manage_messages")
  ) {
    return { ok: false, error: "MISSING_PERMISSION" };
  }
  let account: { accountId: string; username: string };
  if (input.requiredUsername !== null) {
    const requiredUsername = input.requiredUsername.toLowerCase();
    const matching = accounts.find(
      (candidate) => candidate.username.toLowerCase() === requiredUsername,
    );
    if (!matching) return { ok: false, error: "WRONG_ACCOUNT" };
    account = matching;
  } else {
    if (accounts.length === 0) return { ok: false, error: "NO_ACCOUNT" };
    if (accounts.length > 1) return { ok: false, error: "MULTIPLE_ACCOUNTS" };
    account = accounts[0]!;
  }
  try {
    await deps.client.subscribeWebhooks(token, account.accountId);
  } catch (error) {
    if (error instanceof InstagramOAuthError) return { ok: false, error: "SUBSCRIBE_FAILED" };
    throw error;
  }
  await deps.repository.save({
    ...account,
    accessToken: token,
    tokenExpiresAt: inspection.expiresAt,
    kind: "UNIFIED_LOGIN",
    adminId: input.adminId,
  });
  return { ok: true, username: account.username };
}

export async function disconnectInstagram(
  deps: { repository: InstagramConnectionRepository },
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_CONNECTED" }> {
  return (await deps.repository.delete(adminId))
    ? { ok: true }
    : { ok: false, error: "NOT_CONNECTED" };
}

export async function refreshInstagramTokenIfDue(deps: {
  oauth: InstagramOAuthClient | null;
  repository: InstagramConnectionRepository;
  now: () => Date;
}): Promise<"NOT_CONNECTED" | "NOT_EXPIRING" | "NOT_DUE" | "REFRESHED" | "SUPERSEDED"> {
  const current = await deps.repository.find();
  if (!current) return "NOT_CONNECTED";
  if (current.kind === "UNIFIED_LOGIN" || current.tokenExpiresAt === null) return "NOT_EXPIRING";
  if (deps.oauth === null) throw new Error("Instagram Login is not configured");
  const now = deps.now();
  if (current.tokenExpiresAt.getTime() - now.getTime() > 30 * 24 * 60 * 60 * 1000) return "NOT_DUE";
  const token = await deps.oauth.refreshToken(current.accessToken);
  const replaced = await deps.repository.replaceToken({
    expectedVersion: current.tokenVersion,
    accessToken: token.accessToken,
    tokenExpiresAt: new Date(deps.now().getTime() + token.expiresInSeconds * 1000),
  });
  return replaced ? "REFRESHED" : "SUPERSEDED";
}
