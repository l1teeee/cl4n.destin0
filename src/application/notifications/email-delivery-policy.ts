import { EmailDeliveryError } from "./email-delivery-error";

export type EmailDeliveryFailure =
  | { action: "FAIL"; errorCode: string }
  | { action: "RETRY"; errorCode: string; delaySeconds: number };

const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_SECONDS = 3600;
const permanentStatuses = new Set([400, 401, 403, 404]);

export function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 2 ** (attempts - 1), MAX_RETRY_DELAY_SECONDS);
}

function errorCodeFor(error: unknown): string {
  if (!(error instanceof EmailDeliveryError)) {
    return "INTERNAL";
  }
  return error.status === null ? "NETWORK" : `HTTP_${error.status}`;
}

export function classifyEmailDeliveryFailure(
  error: unknown,
  attempts: number,
): EmailDeliveryFailure {
  const errorCode = errorCodeFor(error);
  const isPermanent =
    error instanceof EmailDeliveryError &&
    error.status !== null &&
    permanentStatuses.has(error.status);

  if (isPermanent || attempts >= MAX_ATTEMPTS) {
    return { action: "FAIL", errorCode };
  }

  return { action: "RETRY", errorCode, delaySeconds: retryDelaySeconds(attempts) };
}
