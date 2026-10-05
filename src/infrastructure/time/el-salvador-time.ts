import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const EL_SALVADOR_TIME_ZONE = "America/El_Salvador";

function parseParts(value: string, pattern: RegExp, label: string): number[] {
  const match = pattern.exec(value);
  if (!match) {
    throw new Error(`${label} tiene un formato inválido`);
  }

  return match.slice(1).map(Number);
}

export function localEventDateTimeToUtc(eventDate: string, eventTime: string): Date {
  const [year, month, day] = parseParts(
    eventDate,
    /^(\d{4})-(\d{2})-(\d{2})$/,
    "La fecha del evento",
  );
  const [hour, minute] = parseParts(eventTime, /^(\d{2}):(\d{2})$/, "La hora del evento");
  return buildUtcDate(year!, month!, day!, hour!, minute!);
}

export function localDateTimeToUtc(value: string): Date {
  const [year, month, day, hour, minute] = parseParts(
    value,
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
    "La fecha y hora local",
  );
  return buildUtcDate(year!, month!, day!, hour!, minute!);
}

function buildUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const zoned = TZDate.tz(EL_SALVADOR_TIME_ZONE, year, month - 1, day, hour, minute);
  const matchesInput =
    zoned.getFullYear() === year &&
    zoned.getMonth() === month - 1 &&
    zoned.getDate() === day &&
    zoned.getHours() === hour &&
    zoned.getMinutes() === minute;

  if (!matchesInput) {
    throw new Error("La fecha y hora local es inválida");
  }

  return new Date(zoned.getTime());
}

export function formatUtcForElSalvador(date: Date, pattern = "yyyy-MM-dd HH:mm"): string {
  return format(TZDate.tz(EL_SALVADOR_TIME_ZONE, date), pattern);
}
