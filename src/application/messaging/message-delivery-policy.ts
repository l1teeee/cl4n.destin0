import { retryDelaySeconds } from "@/application/notifications/email-delivery-policy";

import { MessengerError } from "./instagram-messenger";

export type MessageDeliveryFailure =
  | { action: "WAIT_WINDOW"; errorCode: "META_WINDOW_CLOSED" }
  | { action: "RETRY"; errorCode: string; delaySeconds: number }
  | { action: "FAIL"; errorCode: string };

const MAX_ATTEMPTS = 8;
const RETRYABLE_META_CODES = new Set([2, 4, 17, 32, 613]);

function isWindowError(error: MessengerError): boolean {
  return (
    error.code === 10 &&
    (error.subcode === 2534022 ||
      error.subcode === 2018278 ||
      /allowed window|messaging window|24.hour window/i.test(error.message))
  );
}

function permanentMetaCode(error: MessengerError): string | null {
  if (
    error.code === 551 ||
    (error.code === 10 && error.subcode === 2018108) ||
    (error.code === 200 && error.subcode === 1545041)
  ) {
    return "META_USER_UNAVAILABLE";
  }
  if (error.code === 200 && error.subcode === 2018028) {
    return "META_APP_NOT_LIVE";
  }
  if (error.code === 190) {
    return "META_TOKEN_INVALID";
  }
  if (
    error.code === 100 &&
    (error.subcode === null || error.subcode === 2534014 || error.subcode === 2018001)
  ) {
    return "META_INVALID_RECIPIENT";
  }
  return null;
}

function errorCode(error: MessengerError): string {
  if (error.code !== null) {
    return `META_${error.code}_${error.subcode ?? "NONE"}`.slice(0, 200);
  }
  return error.status === null ? "NETWORK" : `HTTP_${error.status}`;
}

export function classifyMessageDeliveryFailure(
  error: unknown,
  attempts: number,
): MessageDeliveryFailure {
  if (error instanceof Error && error.message === "META_NO_MESSAGE_ID") {
    return { action: "FAIL", errorCode: "META_NO_MESSAGE_ID" };
  }
  if (error instanceof MessengerError) {
    if (
      error.status === 200 &&
      error.message === "Instagram response did not include a message id"
    ) {
      return { action: "FAIL", errorCode: "META_NO_MESSAGE_ID" };
    }
    if (isWindowError(error)) {
      return { action: "WAIT_WINDOW", errorCode: "META_WINDOW_CLOSED" };
    }

    const permanentCode = permanentMetaCode(error);
    if (permanentCode) {
      return { action: "FAIL", errorCode: permanentCode };
    }

    const retryable =
      error.status === null ||
      error.status === 429 ||
      (error.status !== null && error.status >= 500) ||
      (error.code !== null && RETRYABLE_META_CODES.has(error.code));
    if (!retryable && error.status !== null && error.status >= 400 && error.status < 500) {
      return { action: "FAIL", errorCode: errorCode(error) };
    }
  }

  const code = error instanceof MessengerError ? errorCode(error) : "INTERNAL";
  return attempts >= MAX_ATTEMPTS
    ? { action: "FAIL", errorCode: code }
    : {
        action: "RETRY",
        errorCode: code,
        delaySeconds: retryDelaySeconds(attempts),
      };
}
