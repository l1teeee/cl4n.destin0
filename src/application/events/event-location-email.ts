import type { EventLocationEmailRepository } from "./location-email-repository";

export function sendEventLocation(
  repository: EventLocationEmailRepository,
  eventId: string,
  actorAdminId: string,
) {
  return repository.queue(eventId, actorAdminId);
}

export function getEventLocationEmailSummary(
  repository: EventLocationEmailRepository,
  eventId: string,
) {
  return repository.getSummary(eventId);
}
