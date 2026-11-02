import {
  InstagramOAuthError,
  type InstagramConnectionRepository,
  type InstagramOAuthClient,
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
      error: "TOKEN_EXCHANGE_FAILED" | "MISSING_PERMISSION" | "WRONG_ACCOUNT" | "SUBSCRIBE_FAILED";
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
    adminId: input.adminId,
  });
  return { ok: true, username: account.username };
}

export async function disconnectInstagram(
  deps: Dependencies,
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_CONNECTED" }> {
  return (await deps.repository.delete(adminId))
    ? { ok: true }
    : { ok: false, error: "NOT_CONNECTED" };
}

export async function refreshInstagramTokenIfDue(
  deps: Dependencies,
): Promise<"NOT_CONNECTED" | "NOT_DUE" | "REFRESHED" | "SUPERSEDED"> {
  const current = await deps.repository.find();
  if (!current) return "NOT_CONNECTED";
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
