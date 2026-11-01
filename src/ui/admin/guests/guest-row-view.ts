import type {
  EventGuestRow,
  GuestLastMessage,
} from "@/infrastructure/db/repositories/event-guest-queries";
import {
  instagramProfileHref,
  messageKindLabel,
  messageStatusCopy,
} from "@/ui/admin/messages/message-copy";
import { formatAdminDate, formatReservationNumber } from "@/ui/admin/view-model";

import { partySizeLabel } from "./guest-copy";
import type { GuestIdentity } from "./guest-identity-list";
import type { GuestRowView } from "./guest-table";

type BadgeView = GuestRowView["status"];
type MessageBadgeView = NonNullable<GuestRowView["message"]>;

export type GuestRowData = Omit<GuestRowView, "detail" | "actions">;

export function guestNames(row: Pick<EventGuestRow, "guest1Name" | "guest2Name">): string[] {
  return row.guest2Name === null ? [row.guest1Name] : [row.guest1Name, row.guest2Name];
}

function guestIdentities(row: EventGuestRow): GuestIdentity[] {
  const guests: GuestIdentity[] = [
    {
      name: row.guest1Name,
      instagram: row.guest1Instagram,
      profileHref: instagramProfileHref(row.guest1Instagram),
    },
  ];
  if (row.guest2Name !== null && row.guest2Instagram !== null) {
    guests.push({
      name: row.guest2Name,
      instagram: row.guest2Instagram,
      profileHref: instagramProfileHref(row.guest2Instagram),
    });
  }
  return guests;
}

function numberLabel(row: EventGuestRow): string {
  if (row.kind === "RESERVATION") return formatReservationNumber(row.number);
  // A cancelled queue entry has no rank any more, only the queue it came from.
  return row.position === null ? "Cola" : `Cola #${row.position}`;
}

function holdingStageView(stage: EventGuestRow["stage"]): BadgeView {
  if (stage === "IN_REVIEW") return { label: "Por revisar", variant: "open" };
  if (stage === "ON_LIST") return { label: "En la lista", variant: "default" };
  if (stage === "PAID") return { label: "Confirmado", variant: "confirmed" };
  throw new Error("A reservation that holds seats needs a stage.");
}

function releasedReservationView(row: EventGuestRow): BadgeView {
  if (row.releaseReason === "REJECTED") return { label: "Rechazado", variant: "rejected" };
  return { label: "Cancelado", variant: "cancelled" };
}

function statusView(row: EventGuestRow): BadgeView {
  if (row.kind === "WAITLIST_ENTRY") {
    if (row.status === "WAITING") return { label: "En cola", variant: "waitlist" };
    if (row.status === "CANCELLED") return { label: "Cancelado", variant: "cancelled" };
  }
  if (row.kind === "RESERVATION") {
    if (row.status === "CONFIRMED") return holdingStageView(row.stage);
    if (row.status === "CANCELLED") return releasedReservationView(row);
    if (row.status === "FULL_REJECTED") return { label: "Sin lugar", variant: "inactive" };
  }
  throw new Error(`Unexpected status ${row.status} for a ${row.kind}.`);
}

// A pending refund is the one thing an admin still has to do, so it wins over the admin origin.
function extraView(row: EventGuestRow): BadgeView | null {
  if (row.refundStatus === "PENDING") return { label: "Reembolso pendiente", variant: "cancelled" };
  if (row.refundStatus === "REFUNDED") return { label: "Reembolso hecho", variant: "default" };
  if (row.source === "ADMIN") return { label: "Agregado por admin", variant: "draft" };
  return null;
}

function messageView(message: GuestLastMessage | null): MessageBadgeView | null {
  if (message === null) return null;

  const status = messageStatusCopy(message.status);
  const label = `${messageKindLabel(message.kind)} · ${status.label}`;
  if (message.lastError === null) return { label, variant: status.variant };
  return { label, variant: status.variant, title: message.lastError };
}

export function guestRowData(row: EventGuestRow): GuestRowData {
  return {
    key: `${row.kind}-${row.id}`,
    numberLabel: numberLabel(row),
    guests: guestIdentities(row),
    partyLabel: partySizeLabel(row.partySize),
    allergies: row.allergies,
    notes: row.notes,
    status: statusView(row),
    extra: extraView(row),
    message: messageView(row.lastMessage),
    submittedLabel: formatAdminDate(row.submittedAt),
  };
}
