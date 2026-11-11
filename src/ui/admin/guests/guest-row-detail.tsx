import { ChevronDown } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { GuestRequestDetail } from "@/infrastructure/db/repositories/event-guest-queries";
import { MessageThread } from "@/ui/admin/messages/message-thread";

import { EraseGuestDataButton } from "./erase-guest-data-button";
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

export type EraseGuestDataAction = (
  subject: { kind: GuestRequestDetail["kind"]; id: string },
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

interface GuestRowDetailProps {
  guest: GuestRequestDetail;
  data: GuestRowData;
  allowCouple: boolean;
  handlers: GuestActionHandlers;
  canErase: boolean;
  eventStarted: boolean;
  eraseAction: EraseGuestDataAction;
}

type EditGuestDataProps = Pick<GuestRowDetailProps, "guest" | "allowCouple" | "handlers">;

function EditGuestData({ guest, allowCouple, handlers }: EditGuestDataProps) {
  const update = guest.kind === "RESERVATION" ? handlers.updateRequest : handlers.updateEntry;

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
          allowCouple={allowCouple || guest.partySize === 2}
        />
      </div>
    </details>
  );
}

const erasedName = "eliminado";

function isHoldingSeat(guest: GuestRequestDetail): boolean {
  return guest.kind === "RESERVATION" ? guest.status === "CONFIRMED" : guest.status === "WAITING";
}

export function GuestRowDetail({
  guest,
  data,
  allowCouple,
  handlers,
  canErase,
  eventStarted,
  eraseAction,
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
          username={guest.contactUsername ?? guest.guest1Instagram}
          canAct={true}
          retryAction={handlers.retryMessage}
          markSentAction={handlers.markMessageSent}
          discardAction={handlers.discardMessage}
          scrollToNewest={false}
        />
      }
      actions={
        <>
          {canEditGuest(guest) ? (
            <EditGuestData guest={guest} allowCouple={allowCouple} handlers={handlers} />
          ) : null}
          {canErase && guest.guest1Name !== erasedName ? (
            <EraseGuestDataButton
              action={eraseAction.bind(null, { kind: guest.kind, id: guest.id })}
              enabled={eventStarted || !isHoldingSeat(guest)}
            />
          ) : null}
        </>
      }
    />
  );
}
