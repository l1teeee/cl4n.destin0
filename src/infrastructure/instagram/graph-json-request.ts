import { InstagramOAuthError } from "@/application/messaging/instagram-connection";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstagramOAuthError("Invalid Instagram response");
  }
  return value as Record<string, unknown>;
}

export async function graphJsonRequest(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) throw new InstagramOAuthError("Instagram request rejected");
    body = await response.json();
  } catch {
    throw new InstagramOAuthError("Instagram request failed");
  }
  return record(body);
}
