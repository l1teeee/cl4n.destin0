import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "@/application/messaging/conversation-queries";
import type { EventGuestRow } from "@/infrastructure/db/repositories/event-guest-queries";
import {
  canEditGuest,
  guestFormDefaults,
  guestTimelineEntries,
  threadMessageViews,
} from "@/ui/admin/guests/guest-detail-view";

function guestRow(overrides: Partial<EventGuestRow> = {}): EventGuestRow {
  return {
    kind: "RESERVATION",
    id: "11111111-1111-4111-8111-111111111111",
    number: 4,
    position: null,
    guest1Name: "Ana López",
    guest1Instagram: "ana.lopez",
    guests: [{ slot: 1, name: "Ana López", instagram: "ana.lopez" }],
    partySize: 1,
    allergies: null,
    notes: null,
    status: "CONFIRMED",
    stage: "IN_REVIEW",
    releaseReason: null,
    refundStatus: null,
    source: "PUBLIC",
    submittedAt: new Date("2026-10-31T01:05:00Z"),
    onListAt: null,
    paidAt: null,
    cancelledAt: null,
    refundedAt: null,
    linkCode: null,
    contactId: null,
    contactUsername: null,
    lastMessage: null,
    ...overrides,
  };
}

function conversationMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "message-1",
    direction: "OUTBOUND",
    kind: "ON_LIST",
    source: "SYSTEM",
    status: "SENT",
    body: "Ya estás en la lista.",
    attachmentIds: [],
    attachmentUrls: [],
    lastError: null,
    sentAt: new Date("2026-10-31T02:00:00Z"),
    readAt: null,
    createdAt: new Date("2026-10-31T02:00:00Z"),
    ...overrides,
  };
}

describe("guestTimelineEntries", () => {
  it("keeps the labels and formats each date in the El Salvador time zone", () => {
    expect(
      guestTimelineEntries([
        { label: "Recibida", at: new Date("2026-10-31T01:05:00Z") },
        { label: "En la lista", at: new Date("2026-10-31T15:30:00Z") },
      ]),
    ).toEqual([
      { label: "Recibida", at: "30/10/2026 19:05" },
      { label: "En la lista", at: "31/10/2026 09:30" },
    ]);
  });

  it("returns an empty list for an empty history", () => {
    expect(guestTimelineEntries([])).toEqual([]);
  });
});

describe("threadMessageViews", () => {
  it("maps an outbound message with its own image links", () => {
    const [view] = threadMessageViews([
      conversationMessage({
        kind: "LOCATION",
        attachmentIds: ["attachment-1"],
        attachmentUrls: [
          "https://clandestino.example/foto-1",
          "https://clandestino.example/foto-2",
        ],
      }),
    ]);

    expect(view).toEqual({
      id: "message-1",
      direction: "OUTBOUND",
      kind: "LOCATION",
      status: "SENT",
      source: "SYSTEM",
      body: "Ya estás en la lista.",
      imageSrcs: ["https://clandestino.example/foto-1", "https://clandestino.example/foto-2"],
      createdAt: new Date("2026-10-31T02:00:00Z"),
      lastError: null,
    });
  });

  it("serves the images of an inbound message from the authenticated attachment route", () => {
    const [view] = threadMessageViews([
      conversationMessage({
        direction: "INBOUND",
        kind: "INBOUND",
        source: "GUEST",
        status: "RECEIVED",
        attachmentIds: ["attachment-1", "attachment-2"],
        attachmentUrls: [],
      }),
    ]);

    expect(view!.imageSrcs).toEqual([
      "/admin/mensajes/adjuntos/attachment-1",
      "/admin/mensajes/adjuntos/attachment-2",
    ]);
  });

  it("keeps the order and the failure reason", () => {
    const views = threadMessageViews([
      conversationMessage({ id: "first" }),
      conversationMessage({ id: "second", status: "FAILED", lastError: "META_190_463" }),
    ]);

    expect(views.map((view) => view.id)).toEqual(["first", "second"]);
    expect(views[1]).toMatchObject({ status: "FAILED", lastError: "META_190_463" });
  });

  it("returns no messages for a request without any", () => {
    expect(threadMessageViews([])).toEqual([]);
  });
});

describe("canEditGuest", () => {
  it.each([
    { case: "a reservation holding seats", row: guestRow(), expected: true },
    { case: "a cancelled reservation", row: guestRow({ status: "CANCELLED" }), expected: true },
    {
      case: "a request that found no space",
      row: guestRow({ status: "FULL_REJECTED" }),
      expected: false,
    },
    {
      case: "a waiting queue entry",
      row: guestRow({ kind: "WAITLIST_ENTRY", status: "WAITING" }),
      expected: true,
    },
    {
      case: "a removed queue entry",
      row: guestRow({ kind: "WAITLIST_ENTRY", status: "CANCELLED" }),
      expected: false,
    },
  ])("is $expected for $case", ({ row, expected }) => {
    expect(canEditGuest(row)).toBe(expected);
  });
});

describe("guestFormDefaults", () => {
  it("fills the form for one person without allergies", () => {
    expect(guestFormDefaults(guestRow())).toEqual({
      partySize: 1,
      guest1Name: "Ana López",
      guest1Instagram: "ana.lopez",
      guest2Name: "",
      guest2Instagram: "",
      hasAllergies: false,
      allergies: "",
      notes: "",
    });
  });

  it("fills both guests, the allergies and the notes of a couple", () => {
    expect(
      guestFormDefaults(
        guestRow({
          partySize: 2,
          allergies: "Ana: maní",
          notes: "Mesa tranquila",
          guests: [
            { slot: 1, name: "Ana López", instagram: "ana.lopez" },
            { slot: 2, name: "Luis Pérez", instagram: "luis_perez" },
          ],
        }),
      ),
    ).toEqual({
      partySize: 2,
      guest1Name: "Ana López",
      guest1Instagram: "ana.lopez",
      guest2Name: "Luis Pérez",
      guest2Instagram: "luis_perez",
      hasAllergies: true,
      allergies: "Ana: maní",
      notes: "Mesa tranquila",
    });
  });
});
