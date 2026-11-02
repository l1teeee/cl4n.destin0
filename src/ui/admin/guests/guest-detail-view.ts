import type { ConversationMessage } from "@/application/messaging/conversation-queries";
import type {
  EventGuestRow,
  GuestTimelineEntry as GuestHistoryEntry,
} from "@/infrastructure/db/repositories/event-guest-queries";
import type { ThreadMessageView } from "@/ui/admin/messages/message-copy";
import { formatAdminDate } from "@/ui/admin/view-model";

import type { GuestTimelineEntry } from "./guest-detail-sheet";
import type { GuestRequestFormValues } from "./guest-request-form";

export function guestTimelineEntries(history: readonly GuestHistoryEntry[]): GuestTimelineEntry[] {
  return history.map((entry) => ({ label: entry.label, at: formatAdminDate(entry.at) }));
}

// Guest replies are stored on the conversation, not on the request, so only the messages sent
// about this request reach the thread.
export function threadMessageViews(messages: readonly ConversationMessage[]): ThreadMessageView[] {
  return messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    kind: message.kind,
    status: message.status,
    source: message.source,
    body: message.body,
    imageSrcs:
      message.direction === "INBOUND"
        ? message.attachmentIds.map((attachmentId) => `/admin/mensajes/adjuntos/${attachmentId}`)
        : message.attachmentUrls,
    createdAt: message.createdAt,
    lastError: message.lastError,
  }));
}

// The server only edits a request that still holds seats (or was cancelled), and a queue entry that
// still waits. Rejected-for-space rows and removed queue entries are history.
export function canEditGuest(row: Pick<EventGuestRow, "kind" | "status">): boolean {
  if (row.kind === "WAITLIST_ENTRY") return row.status === "WAITING";
  return row.status === "CONFIRMED" || row.status === "CANCELLED";
}

export function guestFormDefaults(row: EventGuestRow): GuestRequestFormValues {
  return {
    partySize: row.partySize === 2 ? 2 : 1,
    guest1Name: row.guest1Name,
    guest1Instagram: row.guest1Instagram,
    guest2Name: row.guest2Name ?? "",
    guest2Instagram: row.guest2Instagram ?? "",
    hasAllergies: row.allergies !== null,
    allergies: row.allergies ?? "",
    notes: row.notes ?? "",
  };
}
