export const EVENT_GUEST_VIEWS = [
  "por-revisar",
  "en-la-lista",
  "confirmados",
  "cola",
  "descartados",
  "sin-lugar",
  "todas",
] as const;

export type EventGuestView = (typeof EVENT_GUEST_VIEWS)[number];
