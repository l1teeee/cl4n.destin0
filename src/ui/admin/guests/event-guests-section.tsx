import Link from "next/link";

import type { EventGuestView } from "@/application/guests/guest-views";
import type {
  EventGuestCounts,
  GuestRequestDetail,
  PromotionPreview,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { Button } from "@/ui/primitives/button";

import { AddGuestSheet } from "./add-guest-sheet";
import type { GuestActionHandlers } from "./guest-action-handlers";
import { guestSummaryItems, guestViewTabs } from "./guest-list-view";
import { GuestRowActions } from "./guest-row-actions";
import { GuestRowDetail } from "./guest-row-detail";
import { guestRowData } from "./guest-row-view";
import { GuestSummaryBar } from "./guest-summary-bar";
import { GuestTable, type GuestRowView } from "./guest-table";
import { GuestViewTabs } from "./guest-view-tabs";

interface EventGuestsSectionProps {
  eventId: string;
  view: EventGuestView;
  maxPartySize: number;
  counts: EventGuestCounts;
  guests: readonly GuestRequestDetail[];
  preview: PromotionPreview;
  handlers: GuestActionHandlers;
  paymentMissing: boolean;
}

export function EventGuestsSection({
  eventId,
  view,
  maxPartySize,
  counts,
  guests,
  preview,
  handlers,
  paymentMissing,
}: EventGuestsSectionProps) {
  const allowCouple = maxPartySize >= 2;
  const freeSeats = counts.capacity - counts.occupiedSeats;
  const rows = guests.map((guest): GuestRowView => {
    const data = guestRowData(guest);

    return {
      ...data,
      detail: (
        <GuestRowDetail guest={guest} data={data} allowCouple={allowCouple} handlers={handlers} />
      ),
      actions: (
        <GuestRowActions
          row={guest}
          preview={preview}
          freeSeats={freeSeats}
          queueSize={counts.waitlisted}
          handlers={handlers}
        />
      ),
    };
  });

  return (
    <section className="admin-section admin-tab-section space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="admin-section-title">Invitados</h2>
        <Button variant="outline" asChild>
          <Link href={`/admin/events/${eventId}/export?vista=${view}`}>Exportar CSV</Link>
        </Button>
      </div>
      {paymentMissing ? (
        <p className="admin-muted">
          Faltan datos de pago o precio. Complétalos en Mi cuenta y en la experiencia.
        </p>
      ) : null}
      <ActionFeedbackProvider>
        <GuestSummaryBar items={guestSummaryItems(counts)} />
        <GuestViewTabs views={guestViewTabs(eventId, counts)} activeId={view} />
        <div>
          <AddGuestSheet action={handlers.add.bind(null, eventId)} allowCouple={allowCouple} />
        </div>
        <GuestTable rows={rows} emptyText="No hay personas en esta vista." />
      </ActionFeedbackProvider>
    </section>
  );
}
