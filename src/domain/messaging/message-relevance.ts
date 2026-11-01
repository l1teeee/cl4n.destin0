import type { MessageKind } from "./message-types";

export interface MessageRelevanceState {
  reservationStatus: string | null;
  reservationStage: string | null;
  waitlistStatus: string | null;
  locationStatus: string | null;
  messageLocationRevision: number | null;
  currentLocationRevision: number | null;
  cluePresent: boolean;
  eventStatus: string | null;
  eventDeleted: boolean;
}

export function isStillRelevant(kind: MessageKind, state: MessageRelevanceState): boolean {
  const eventIsLive =
    !state.eventDeleted && state.eventStatus !== "CANCELLED" && state.eventStatus !== "COMPLETED";
  switch (kind) {
    case "REQUEST_RECEIVED":
      return eventIsLive && state.reservationStatus === "CONFIRMED";
    case "WAITLISTED":
      return eventIsLive && state.waitlistStatus === "WAITING";
    case "PROMOTED":
      return (
        eventIsLive &&
        state.reservationStatus === "CONFIRMED" &&
        state.reservationStage === "IN_REVIEW"
      );
    case "ON_LIST":
      return (
        eventIsLive &&
        state.reservationStatus === "CONFIRMED" &&
        state.reservationStage === "ON_LIST"
      );
    case "PAID":
      return (
        eventIsLive && state.reservationStatus === "CONFIRMED" && state.reservationStage === "PAID"
      );
    case "LOCATION":
      return (
        eventIsLive &&
        state.reservationStatus === "CONFIRMED" &&
        state.reservationStage === "PAID" &&
        state.locationStatus === "CONFIRMED" &&
        state.messageLocationRevision === state.currentLocationRevision
      );
    case "CLUE":
      return (
        eventIsLive &&
        state.reservationStatus === "CONFIRMED" &&
        state.reservationStage === "PAID" &&
        state.cluePresent
      );
    case "REJECTED":
    case "CANCELLED_UNPAID":
    case "CANCELLED_PAID":
    case "REFUNDED":
    case "FREE_TEXT":
      return true;
    case "INBOUND":
      return false;
  }
}
