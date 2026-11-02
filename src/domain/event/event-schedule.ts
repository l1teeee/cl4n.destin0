export const OPENING_MARGIN_MS = 2 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// The form picks minutes, so the suggested opening is the first whole minute that is not past.
export function roundUpToNextMinute(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

export const scheduleMessages = {
  startsAtNotFuture: "La fecha de la cena debe ser futura.",
  opensAtInPast: "La apertura ya pasó. Usa una hora actual o 'Abrir ahora'.",
  closesAtNotAfterOpening: "El cierre debe ser después de la apertura.",
  closesAtNotBeforeDinner: "El cierre debe ser antes de la cena.",
} as const;

export type ScheduleField = "startsAt" | "opensAt" | "closesAt";

// The form names the dinner date field "eventDate", so the caller maps startsAt to it.
export type ScheduleErrors = Partial<Record<ScheduleField, string>>;

export interface EventScheduleInput {
  startsAt: Date;
  opensAt: Date;
  closesAt: Date;
  // Database time, never the browser or application clock.
  now: Date;
  // Null when the event is being created.
  previousStartsAt: Date | null;
  previousOpensAt: Date | null;
  eventIsOpenOrClosed: boolean;
}

// A past or closed event must stay editable, so an unchanged dinner time is not rechecked.
function startsAtNeedsCheck(input: EventScheduleInput): boolean {
  if (input.previousStartsAt === null) return true;
  return input.startsAt.getTime() !== input.previousStartsAt.getTime();
}

function opensAtNeedsCheck(input: EventScheduleInput): boolean {
  if (input.previousOpensAt === null) return true;
  if (input.eventIsOpenOrClosed) return false;
  return input.opensAt.getTime() !== input.previousOpensAt.getTime();
}

export function validateEventSchedule(input: EventScheduleInput): ScheduleErrors {
  const errors: ScheduleErrors = {};

  if (startsAtNeedsCheck(input) && input.startsAt.getTime() <= input.now.getTime()) {
    errors.startsAt = scheduleMessages.startsAtNotFuture;
  }
  if (
    opensAtNeedsCheck(input) &&
    input.opensAt.getTime() < input.now.getTime() - OPENING_MARGIN_MS
  ) {
    errors.opensAt = scheduleMessages.opensAtInPast;
  }
  if (input.closesAt.getTime() <= input.opensAt.getTime()) {
    errors.closesAt = scheduleMessages.closesAtNotAfterOpening;
  } else if (input.closesAt.getTime() > input.startsAt.getTime()) {
    errors.closesAt = scheduleMessages.closesAtNotBeforeDinner;
  }

  return errors;
}
