import type { LoadedLocationVersion } from "./types";
import type { EventLocationEmailRepository } from "./location-email-repository";

export function sendEventLocation(
  repository: EventLocationEmailRepository,
  eventId: string,
  loadedLocation: LoadedLocationVersion,
  actorAdminId: string,
) {
  return repository.queue(eventId, loadedLocation, actorAdminId);
}

export function getEventLocationEmailSummary(
  repository: EventLocationEmailRepository,
  eventId: string,
) {
  return repository.getSummary(eventId);
}
