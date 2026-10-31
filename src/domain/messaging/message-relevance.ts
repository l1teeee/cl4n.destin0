import type { MessageKind } from "./message-types";

export interface MessageRelevanceState {
  reservationStatus: string | null;
  reservationStage: string | null;
  waitlistStatus: string | null;
  locationStatus: string | null;
  messageLocationRevision: number | null;
  currentLocationRevision: number | null;
  cluePresent: boolean;
}

export function isStillRelevant(kind: MessageKind, state: MessageRelevanceState): boolean {
  switch (kind) {
    case "REQUEST_RECEIVED":
      return state.reservationStatus === "CONFIRMED";
    case "WAITLISTED":
      return state.waitlistStatus === "WAITING";
    case "PROMOTED":
      return state.reservationStatus === "CONFIRMED" && state.reservationStage === "IN_REVIEW";
    case "ON_LIST":
      return state.reservationStatus === "CONFIRMED" && state.reservationStage === "ON_LIST";
    case "PAID":
      return state.reservationStatus === "CONFIRMED" && state.reservationStage === "PAID";
    case "LOCATION":
      return (
        state.reservationStatus === "CONFIRMED" &&
        state.reservationStage === "PAID" &&
        state.locationStatus === "CONFIRMED" &&
        state.messageLocationRevision === state.currentLocationRevision
      );
    case "CLUE":
      return (
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
