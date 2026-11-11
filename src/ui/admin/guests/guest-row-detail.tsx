import { ChevronDown } from "lucide-react";

import type { GuestRequestDetail } from "@/infrastructure/db/repositories/event-guest-queries";
import { MessageThread } from "@/ui/admin/messages/message-thread";

import type { GuestActionHandlers } from "./guest-action-handlers";
import { guestsLabel } from "./guest-copy";
import { GuestDetailSheet } from "./guest-detail-sheet";
import {
  canEditGuest,
  guestFormDefaults,
  guestTimelineEntries,
  threadMessageViews,
} from "./guest-detail-view";
import { GuestRequestForm } from "./guest-request-form";
import type { GuestRowData } from "./guest-row-view";

interface GuestRowDetailProps {
  guest: GuestRequestDetail;
  data: GuestRowData;
  allowCouple: boolean;
  maxPartySize?: number;
  handlers: GuestActionHandlers;
}

type EditGuestDataProps = Omit<GuestRowDetailProps, "data">;

function EditGuestData({ guest, allowCouple, maxPartySize, handlers }: EditGuestDataProps) {
  const update = guest.kind === "RESERVATION" ? handlers.updateRequest : handlers.updateEntry;
  const effectiveMax = Math.max(maxPartySize ?? (allowCouple ? 2 : 1), guest.partySize);

  return (
    <details className="group">
      <summary className="admin-muted flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fffbf4] [&::-webkit-details-marker]:hidden [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary">
        Editar datos
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-4">
        <GuestRequestForm
          action={update.bind(null, guest.id)}
          submitLabel="Guardar cambios"
          defaultValues={guestFormDefaults(guest)}
          allowCouple={allowCouple || guest.partySize >= 2}
          maxPartySize={effectiveMax}
        />
      </div>
    </details>
  );
}

export function GuestRowDetail({
  guest,
  data,
  allowCouple,
  maxPartySize,
  handlers,
}: GuestRowDetailProps) {
  return (
    <GuestDetailSheet
      triggerLabel="Ver ficha"
      title={guestsLabel(data.guests.map((identity) => identity.name))}
      subtitle={`${data.numberLabel} · ${data.status.label}`}
      guests={data.guests}
      partyLabel={data.partyLabel}
      allergies={data.allergies}
      notes={data.notes}
      timeline={guestTimelineEntries(guest.timeline)}
      messages={
        <MessageThread
          messages={threadMessageViews(guest.messages)}
          username={guest.contactUsername ?? guest.guests[0]?.instagram ?? guest.guest1Instagram}
          canAct={true}
          retryAction={handlers.retryMessage}
          markSentAction={handlers.markMessageSent}
          discardAction={handlers.discardMessage}
          scrollToNewest={false}
        />
      }
      actions={
        canEditGuest(guest) ? (
          <EditGuestData
            guest={guest}
            allowCouple={allowCouple}
            maxPartySize={maxPartySize}
            handlers={handlers}
          />
        ) : null
      }
    />
  );
}
