import { describe, expect, it } from "vitest";

import { EmailDeliveryError } from "@/application/notifications/email-delivery-error";
import {
  classifyEmailDeliveryFailure,
  retryDelaySeconds,
} from "@/application/notifications/email-delivery-policy";

describe("retryDelaySeconds", () => {
  it.each([
    [1, 60],
    [2, 120],
    [3, 240],
    [4, 480],
    [5, 960],
    [6, 1920],
    [7, 3600],
    [8, 3600],
  ])("waits %i attempts -> %i seconds", (attempts, expected) => {
    expect(retryDelaySeconds(attempts)).toBe(expected);
  });
});

describe("classifyEmailDeliveryFailure", () => {
  it.each([400, 401, 403, 404])("fails permanently on HTTP %i", (status) => {
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(status, "rejected"), 1)).toEqual({
      action: "FAIL",
      errorCode: `HTTP_${status}`,
    });
  });

  it.each([429, 500, 502, 503])("retries HTTP %i with backoff", (status) => {
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(status, "busy"), 3)).toEqual({
      action: "RETRY",
      errorCode: `HTTP_${status}`,
      delaySeconds: 240,
    });
  });

  it("retries network failures with the NETWORK code", () => {
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(null, "offline"), 1)).toEqual({
      action: "RETRY",
      errorCode: "NETWORK",
      delaySeconds: 60,
    });
  });

  it("retries unexpected errors with the INTERNAL code", () => {
    expect(classifyEmailDeliveryFailure(new Error("boom"), 2)).toEqual({
      action: "RETRY",
      errorCode: "INTERNAL",
      delaySeconds: 120,
    });
  });

  it("gives up on the eighth attempt", () => {
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(503, "busy"), 7).action).toBe(
      "RETRY",
    );
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(503, "busy"), 8)).toEqual({
      action: "FAIL",
      errorCode: "HTTP_503",
    });
    expect(classifyEmailDeliveryFailure(new EmailDeliveryError(null, "offline"), 8)).toEqual({
      action: "FAIL",
      errorCode: "NETWORK",
    });
  });
});
