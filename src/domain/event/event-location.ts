export type EventLocationStatus = "PENDING" | "CONFIRMED";

export interface EventLocationConfirmationInput {
  address: string | null;
  mapsUrl: string | null;
  status: EventLocationStatus;
}

export function isEventLocationConfirmationValid(
  location: EventLocationConfirmationInput,
): boolean {
  return location.status === "PENDING" || location.address !== null || location.mapsUrl !== null;
}
