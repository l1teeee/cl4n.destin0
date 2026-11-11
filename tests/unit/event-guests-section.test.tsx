// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EVENT_GUEST_VIEWS } from "@/application/guests/guest-views";
import type { EventGuestCounts } from "@/infrastructure/db/repositories/event-guest-queries";
import { EventGuestsSection } from "@/ui/admin/guests/event-guests-section";
import type { GuestActionHandlers } from "@/ui/admin/guests/guest-action-handlers";

afterEach(cleanup);

const warning = "Faltan datos de pago o precio. Complétalos en Mi cuenta y en la experiencia.";
const counts: EventGuestCounts = {
  counts: Object.fromEntries(
    EVENT_GUEST_VIEWS.map((view) => [view, 0]),
  ) as EventGuestCounts["counts"],
  occupiedSeats: 0,
  capacity: 10,
  waitlisted: 0,
  waitlistCapacity: 5,
  pendingMessages: 0,
};

function renderSection(paymentMissing: boolean) {
  return render(
    <EventGuestsSection
      eventId="event-id"
      view="por-revisar"
      maxPartySize={2}
      counts={counts}
      guests={[]}
      preview={{ waitingCount: 0, waiting: [], oneSeat: [], twoSeats: [] }}
      handlers={{ add: vi.fn() } as unknown as GuestActionHandlers}
      paymentMissing={paymentMissing}
      canErase={false}
      eventStarted={false}
      eraseAction={vi.fn()}
    />,
  );
}

describe("EventGuestsSection payment warning", () => {
  it("warns when the payment data or the price is missing", () => {
    renderSection(true);

    expect(screen.getByText(warning)).toBeDefined();
  });

  it("shows no warning when both are set", () => {
    renderSection(false);

    expect(screen.queryByText(warning)).toBeNull();
  });
});
