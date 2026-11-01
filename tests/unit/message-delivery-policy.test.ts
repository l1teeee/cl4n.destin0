import { describe, expect, it } from "vitest";

import { MessengerError } from "@/application/messaging/instagram-messenger";
import { classifyMessageDeliveryFailure } from "@/application/messaging/message-delivery-policy";

describe("message delivery policy", () => {
  it.each([2534022, 2018278])("waits for window on Meta subcode %s", (subcode) => {
    expect(
      classifyMessageDeliveryFailure(
        new MessengerError("outside window", { status: 400, code: 10, subcode }),
        1,
      ),
    ).toEqual({ action: "WAIT_WINDOW", errorCode: "META_WINDOW_CLOSED" });
  });

  it("recognizes a code 10 allowed-window message", () => {
    expect(
      classifyMessageDeliveryFailure(
        new MessengerError("Outside the allowed messaging window", {
          status: 400,
          code: 10,
          subcode: 999,
        }),
        1,
      ).action,
    ).toBe("WAIT_WINDOW");
  });

  it.each([
    [551, null, "META_USER_UNAVAILABLE"],
    [10, 2018108, "META_USER_UNAVAILABLE"],
    [200, 1545041, "META_USER_UNAVAILABLE"],
    [200, 2018028, "META_APP_NOT_LIVE"],
    [190, null, "META_TOKEN_INVALID"],
    [100, 2534014, "META_INVALID_RECIPIENT"],
  ])("maps Meta %s/%s", (code, subcode, expected) => {
    expect(
      classifyMessageDeliveryFailure(
        new MessengerError("permanent", { status: 400, code, subcode }),
        1,
      ),
    ).toEqual({ action: "FAIL", errorCode: expected });
  });

  it.each([
    new MessengerError("network", { status: null }),
    new MessengerError("server", { status: 500 }),
    new MessengerError("rate", { status: 429 }),
    new MessengerError("meta rate", { status: 400, code: 613 }),
    new Error("unexpected"),
  ])("retries transient errors with email backoff", (error) => {
    expect(classifyMessageDeliveryFailure(error, 2)).toMatchObject({
      action: "RETRY",
      delaySeconds: 120,
    });
  });

  it("fails a transient error on attempt eight", () => {
    expect(
      classifyMessageDeliveryFailure(new MessengerError("server", { status: 500 }), 8),
    ).toEqual({ action: "FAIL", errorCode: "HTTP_500" });
  });

  it("fails an unclassified 4xx with a bounded code", () => {
    expect(
      classifyMessageDeliveryFailure(
        new MessengerError("bad", { status: 400, code: 42, subcode: 9 }),
        1,
      ),
    ).toEqual({ action: "FAIL", errorCode: "META_42_9" });
  });
});
