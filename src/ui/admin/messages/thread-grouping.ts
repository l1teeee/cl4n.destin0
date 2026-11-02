import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";

import type { ThreadMessageView } from "./message-copy";

const TIME_ZONE = "America/El_Salvador";
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface MessageGroup {
  kind: "group";
  key: string;
  direction: ThreadMessageView["direction"];
  messages: ThreadMessageView[];
  timeLabel: string;
}

export interface DaySeparator {
  kind: "day";
  key: string;
  label: string;
}

export type ThreadItem = DaySeparator | MessageGroup;

function local(date: Date): TZDate {
  return TZDate.tz(TIME_ZONE, date);
}

function dayKey(date: Date): string {
  return format(local(date), "yyyy-MM-dd");
}

export function dayLabel(date: Date, now: Date): string {
  const localDate = local(date);
  const days = differenceInCalendarDays(local(now), localDate);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";

  const sameYear = localDate.getFullYear() === local(now).getFullYear();
  return format(localDate, sameYear ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: es });
}

function startsNewGroup(group: MessageGroup, message: ThreadMessageView): boolean {
  const previous = group.messages.at(-1);
  if (!previous) return true;

  return (
    previous.direction !== message.direction ||
    message.createdAt.getTime() - previous.createdAt.getTime() > GROUP_WINDOW_MS
  );
}

function newGroup(message: ThreadMessageView): MessageGroup {
  return {
    kind: "group",
    key: message.id,
    direction: message.direction,
    messages: [message],
    timeLabel: format(local(message.createdAt), "HH:mm"),
  };
}

// Messages arrive oldest first. A group is a run of same-direction messages sent within five
// minutes of each other on the same day; the time label belongs to its newest message.
export function buildThreadItems(messages: readonly ThreadMessageView[], now: Date): ThreadItem[] {
  const items: ThreadItem[] = [];
  let currentGroup: MessageGroup | null = null;
  let currentDay: string | null = null;

  for (const message of messages) {
    const messageDay = dayKey(message.createdAt);
    if (messageDay !== currentDay) {
      items.push({
        kind: "day",
        key: `day-${messageDay}`,
        label: dayLabel(message.createdAt, now),
      });
      currentDay = messageDay;
      currentGroup = null;
    }

    if (currentGroup && !startsNewGroup(currentGroup, message)) {
      currentGroup.messages.push(message);
      currentGroup.timeLabel = format(local(message.createdAt), "HH:mm");
      continue;
    }

    currentGroup = newGroup(message);
    items.push(currentGroup);
  }

  return items;
}
