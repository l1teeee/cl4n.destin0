import { validateEventSchedule, type ScheduleErrors } from "@/domain/event/event-schedule";

import type { EventRepository } from "./event-repository";

export interface ScheduleRequest {
  startsAt: Date;
  opensAt: Date;
  closesAt: Date;
  openNow: boolean;
}

export type ScheduleResolution =
  { ok: true; opensAt: Date } | { ok: false; errors: ScheduleErrors };

interface ScheduleContext {
  now: Date;
  previousStartsAt: Date | null;
  previousOpensAt: Date | null;
  eventIsOpenOrClosed: boolean;
}

function resolveSchedule(request: ScheduleRequest, context: ScheduleContext): ScheduleResolution {
  // "Abrir ahora" has no meaning once the event already opened, so the typed value stays.
  const opensNow = request.openNow && !context.eventIsOpenOrClosed;
  const opensAt = opensNow ? context.now : request.opensAt;
  const errors = validateEventSchedule({
    startsAt: request.startsAt,
    opensAt,
    closesAt: request.closesAt,
    now: context.now,
    previousStartsAt: context.previousStartsAt,
    previousOpensAt: context.previousOpensAt,
    eventIsOpenOrClosed: context.eventIsOpenOrClosed,
  });
  return Object.keys(errors).length === 0 ? { ok: true, opensAt } : { ok: false, errors };
}

export async function resolveCreateSchedule(
  repository: EventRepository,
  request: ScheduleRequest,
): Promise<ScheduleResolution> {
  const now = await repository.databaseTime();
  return resolveSchedule(request, {
    now,
    previousStartsAt: null,
    previousOpensAt: null,
    eventIsOpenOrClosed: false,
  });
}

export async function resolveUpdateSchedule(
  repository: EventRepository,
  eventId: string,
  request: ScheduleRequest,
): Promise<ScheduleResolution> {
  const { databaseTime, value: current } = await repository.getAdminEvent(eventId);
  // A missing event is reported by the update itself.
  if (current === null) return { ok: true, opensAt: request.opensAt };
  const eventIsOpenOrClosed = current.phase !== "DRAFT" && current.phase !== "SCHEDULED";
  return resolveSchedule(request, {
    now: databaseTime,
    previousStartsAt: current.startsAt,
    previousOpensAt: current.opensAt,
    eventIsOpenOrClosed,
  });
}
