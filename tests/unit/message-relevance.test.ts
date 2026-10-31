import { describe, expect, it } from "vitest";

import { isStillRelevant, type MessageRelevanceState } from "@/domain/messaging/message-relevance";
import type { MessageKind } from "@/domain/messaging/message-types";

const base: MessageRelevanceState = {
  reservationStatus: "CONFIRMED",
  reservationStage: "PAID",
  waitlistStatus: "WAITING",
  locationStatus: "CONFIRMED",
  messageLocationRevision: 2,
  currentLocationRevision: 2,
  cluePresent: true,
};

describe("message relevance", () => {
  it.each<[MessageKind, Partial<MessageRelevanceState>, boolean]>([
    ["REQUEST_RECEIVED", {}, true],
    ["REQUEST_RECEIVED", { reservationStatus: "CANCELLED" }, false],
    ["WAITLISTED", {}, true],
    ["WAITLISTED", { waitlistStatus: "PROMOTED" }, false],
    ["PROMOTED", { reservationStage: "IN_REVIEW" }, true],
    ["PROMOTED", {}, false],
    ["ON_LIST", { reservationStage: "ON_LIST" }, true],
    ["PAID", {}, true],
    ["LOCATION", {}, true],
    ["LOCATION", { currentLocationRevision: 3 }, false],
    ["LOCATION", { locationStatus: "PENDING" }, false],
    ["CLUE", {}, true],
    ["CLUE", { cluePresent: false }, false],
    ["REJECTED", { reservationStatus: null }, true],
    ["CANCELLED_UNPAID", { reservationStatus: null }, true],
    ["CANCELLED_PAID", { reservationStatus: null }, true],
    ["REFUNDED", { reservationStatus: null }, true],
    ["FREE_TEXT", { reservationStatus: null }, true],
    ["INBOUND", {}, false],
  ])("classifies %s", (kind, changes, expected) => {
    expect(isStillRelevant(kind, { ...base, ...changes })).toBe(expected);
  });
});
