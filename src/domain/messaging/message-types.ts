import { PAYMENT_MESSAGE_VARIABLES } from "./payment-message";

export const MESSAGE_KINDS = [
  "REQUEST_RECEIVED",
  "WAITLISTED",
  "PROMOTED",
  "ON_LIST",
  "PAID",
  "REJECTED",
  "CANCELLED_UNPAID",
  "CANCELLED_PAID",
  "REFUNDED",
  "LOCATION",
  "CLUE",
  "FREE_TEXT",
  "INBOUND",
] as const;

export const MESSAGE_STATUSES = [
  "WAITING_CONTACT",
  "WAITING_WINDOW",
  "QUEUED",
  "SENT",
  "READ",
  "FAILED",
  "SENT_MANUALLY",
  "DISCARDED",
  "RECEIVED",
] as const;

export const MESSAGE_SOURCES = ["SYSTEM", "ADMIN", "INSTAGRAM_APP", "GUEST"] as const;
export const MESSAGE_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;

export const TEMPLATE_KEYS = [
  "REQUEST_RECEIVED",
  "WAITLISTED",
  "PROMOTED",
  "ON_LIST",
  "PAID",
  "REJECTED",
  "CANCELLED_UNPAID",
  "CANCELLED_PAID",
  "REFUNDED",
  "LOCATION",
  "TAB",
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type MessageSource = (typeof MESSAGE_SOURCES)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
// Templates sent as their own message kind; TAB goes out as an admin FREE_TEXT message.
export type StatusMessageKind = Extract<TemplateKey, MessageKind>;

const COMMON_VARIABLES = ["nombre", "nombres", "fecha"] as const;

export const TEMPLATE_VARIABLES: Record<TemplateKey, readonly string[]> = {
  REQUEST_RECEIVED: COMMON_VARIABLES,
  WAITLISTED: [...COMMON_VARIABLES, "posicion"],
  PROMOTED: COMMON_VARIABLES,
  ON_LIST: [...COMMON_VARIABLES, ...PAYMENT_MESSAGE_VARIABLES],
  PAID: COMMON_VARIABLES,
  REJECTED: COMMON_VARIABLES,
  CANCELLED_UNPAID: COMMON_VARIABLES,
  CANCELLED_PAID: COMMON_VARIABLES,
  REFUNDED: COMMON_VARIABLES,
  LOCATION: [...COMMON_VARIABLES, "ubicacion"],
  TAB: [
    "nombre",
    "fecha",
    "consumos",
    "total",
    "banco",
    "tipo_cuenta",
    "cuenta",
    "titular",
    "enlace_pago",
    "datos_pago",
  ],
};
