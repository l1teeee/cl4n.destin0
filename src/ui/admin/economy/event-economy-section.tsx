"use client";

import { useState } from "react";

import type { EventEconomy } from "@/application/economy/economy-repository";
import type { TabMessagePreview } from "@/application/economy/tab-messages";
import type { PickerItem } from "@/application/extras/extra-repository";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { groupAccentClass } from "@/ui/admin/guest-send/guest-send-model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

import type { EconomyHandlers } from "./economy-handlers";
import {
  economySummary,
  filterGuests,
  guestHeading,
  guestKey,
  stageLabel,
  tabFilters,
  type TabFilter,
} from "./economy-view";
import { GuestTabSheet } from "./guest-tab-sheet";

interface EventEconomySectionProps {
  eventId: string;
  economy: EventEconomy;
  drinks: readonly PickerItem[];
  extras: readonly PickerItem[];
  tabPreviews: readonly TabMessagePreview[];
  handlers: EconomyHandlers;
}

export function EventEconomySection({
  eventId,
  economy,
  drinks,
  extras,
  tabPreviews,
  handlers,
}: EventEconomySectionProps) {
  const [filter, setFilter] = useState<TabFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const visibleGuests = filterGuests(economy.guests, filter, query);
  // Indexes follow the full list, so a reservation keeps its color while filtering.
  const groupIndexes = new Map<string, number>();
  const reservationSizes = new Map<string, number>();
  for (const guest of economy.guests) {
    if (!groupIndexes.has(guest.reservationId)) {
      groupIndexes.set(guest.reservationId, groupIndexes.size);
    }
    reservationSizes.set(guest.reservationId, (reservationSizes.get(guest.reservationId) ?? 0) + 1);
  }
  // The sheet reads the guest from the latest data, so it stays open and current after each action.
  const selectedGuest = economy.guests.find((guest) => guestKey(guest) === selectedKey) ?? null;
  const preview = selectedGuest
    ? tabPreviews.find(
        (item) =>
          item.reservationId === selectedGuest.reservationId && item.slot === selectedGuest.slot,
      )
    : undefined;

  return (
    <section className="admin-section admin-tab-section space-y-5">
      <div>
        <h2 className="admin-section-title">Economía</h2>
        <p className="mt-2 text-4xl font-semibold" aria-label="Total de la experiencia">
          {formatDrinkPrice(economy.eventTotalCents)}
        </p>
        <p className="admin-muted">{economySummary(economy.guests)}</p>
      </div>

      {economy.guests.length === 0 ? (
        <p className="admin-empty">Todavía no hay invitados en la lista o pagados.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar cuentas">
            {tabFilters.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={filter === item.id ? "default" : "outline"}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Input
            type="search"
            className="text-base"
            placeholder="Buscar por nombre o Instagram"
            aria-label="Buscar invitado"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {visibleGuests.length === 0 ? (
            <p className="admin-empty">Ningún invitado coincide con la búsqueda.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {visibleGuests.map((guest) => (
                <li
                  key={guestKey(guest)}
                  className={`border-l-4 pl-3 ${groupAccentClass(groupIndexes.get(guest.reservationId) ?? 0)}`}
                >
                  <button
                    type="button"
                    className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    onClick={() => setSelectedKey(guestKey(guest))}
                  >
                    <span className="grid min-w-0 gap-1.5">
                      <span className="font-medium break-words">
                        {guestHeading(guest)}
                        {reservationSizes.get(guest.reservationId) === 2 ? (
                          <span className="admin-muted ml-2 text-xs font-normal">Juntos</span>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant={guest.stage === "PAID" ? "confirmed" : "open"}>
                          {stageLabel(guest.stage)}
                        </Badge>
                        {guest.settled ? <Badge variant="active">Pagado</Badge> : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-lg font-semibold">
                      {formatDrinkPrice(guest.totalCents)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <GuestTabSheet
        eventId={eventId}
        guest={selectedGuest}
        drinks={drinks}
        extras={extras}
        tabMessage={preview?.text ?? null}
        handlers={handlers}
        onClose={() => setSelectedKey(null)}
      />
    </section>
  );
}
