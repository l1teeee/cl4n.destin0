import type { EventLifecycleStatus } from "@/domain/event/event-phase";
import {
  normalizeMapsUrl,
  parseMapsCoordinates,
  type EventLocationStatus,
  type MapsCoordinates,
} from "@/domain/event/event-location";

import type { EventRepository } from "./event-repository";
import type { MapsLinkResolver } from "./maps-link-resolver";
import type {
  AdminReservationQuery,
  AuditLogQuery,
  CreateEventCommand,
  LoadedLocationVersion,
  RosterView,
  UpdateEventCommand,
} from "./types";

export type CreateEventInput = Omit<CreateEventCommand, "coordinates">;
export type UpdateEventInput = Omit<UpdateEventCommand, "coordinates">;

async function resolveMapsCoordinates(
  resolver: MapsLinkResolver,
  mapsUrl: string | null,
): Promise<MapsCoordinates | null> {
  if (mapsUrl === null) return null;
  const direct = parseMapsCoordinates(mapsUrl);
  if (direct) return direct;
  const expanded = await resolver.expand(mapsUrl);
  return expanded === null ? null : parseMapsCoordinates(expanded);
}

async function resolveUpdateCoordinates(
  repository: EventRepository,
  resolver: MapsLinkResolver,
  input: UpdateEventInput,
): Promise<MapsCoordinates | null> {
  const nextMapsUrl = input.location.mapsUrl;
  if (nextMapsUrl === null) return null;

  // Saving unrelated fields must not trigger an outbound lookup for a link that is already resolved.
  const current = await repository.getAdminEvent(input.id);
  const stored = current.value?.location;
  const linkUnchanged =
    stored?.mapsUrl != null && normalizeMapsUrl(stored.mapsUrl) === normalizeMapsUrl(nextMapsUrl);
  const hasStoredCoordinates = stored?.latitude != null && stored.longitude != null;
  if (linkUnchanged && hasStoredCoordinates) return null;

  return resolveMapsCoordinates(resolver, nextMapsUrl);
}

export async function createEvent(
  repository: EventRepository,
  resolver: MapsLinkResolver,
  input: CreateEventInput,
  actorId: string,
) {
  const coordinates = await resolveMapsCoordinates(resolver, input.location.mapsUrl);
  return repository.create({ ...input, coordinates }, actorId);
}

export async function updateEvent(
  repository: EventRepository,
  resolver: MapsLinkResolver,
  input: UpdateEventInput,
  actorId: string,
) {
  // Resolved before the transaction so outbound HTTP never holds the event row lock.
  const coordinates = await resolveUpdateCoordinates(repository, resolver, input);
  return repository.update({ ...input, coordinates }, actorId);
}

export function setLocationStatus(
  repository: EventRepository,
  id: string,
  status: EventLocationStatus,
  expectedLocation: LoadedLocationVersion,
  actorId: string,
) {
  return repository.setLocationStatus(id, status, expectedLocation, actorId);
}

export function publishEvent(repository: EventRepository, id: string, actorId: string) {
  return repository.publish(id, actorId);
}

export function openEventNow(repository: EventRepository, id: string, actorId: string) {
  return repository.openNow(id, actorId);
}

export function closeEventNow(repository: EventRepository, id: string, actorId: string) {
  return repository.closeNow(id, actorId);
}

export function completeEvent(repository: EventRepository, id: string, actorId: string) {
  return repository.complete(id, actorId);
}

export function cancelEvent(repository: EventRepository, id: string, actorId: string) {
  return repository.cancel(id, actorId);
}

export function changeCapacity(
  repository: EventRepository,
  id: string,
  capacity: number,
  actorId: string,
) {
  return repository.changeCapacity(id, capacity, actorId);
}

export function changeWaitlistCapacity(
  repository: EventRepository,
  id: string,
  waitlistCapacity: number,
  actorId: string,
) {
  return repository.changeWaitlistCapacity(id, waitlistCapacity, actorId);
}

export function getAdminEventList(repository: EventRepository) {
  return repository.listAdminEvents();
}

export function getAdminEventDetail(repository: EventRepository, id: string) {
  return repository.getAdminEvent(id);
}

export function getAdminReservationList(repository: EventRepository, query: AdminReservationQuery) {
  return repository.listAdminReservations(query);
}

export function getEventRoster(repository: EventRepository, eventId: string, view: RosterView) {
  return repository.listEventRoster(eventId, view);
}

export function getEventRosterCounts(repository: EventRepository, eventId: string) {
  return repository.countEventRoster(eventId);
}

export function getAdminAuditLog(repository: EventRepository, query: AuditLogQuery) {
  return repository.listAuditLogs(query);
}

export function getPublicHomeEvents(repository: EventRepository) {
  return repository.getPublicHomeEvents();
}

export function getPublicEventBySlug(repository: EventRepository, slug: string) {
  return repository.getPublicEventBySlug(slug);
}

export type { EventLifecycleStatus };
