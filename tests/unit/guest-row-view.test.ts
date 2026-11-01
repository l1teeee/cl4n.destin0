import { describe, expect, it } from "vitest";

import type { EventGuestRow } from "@/infrastructure/db/repositories/event-guest-queries";
import { guestNames, guestRowData } from "@/ui/admin/guests/guest-row-view";

const requestId = "11111111-1111-4111-8111-111111111111";

function guestRow(overrides: Partial<EventGuestRow> = {}): EventGuestRow {
  return {
    kind: "RESERVATION",
    id: requestId,
    number: 4,
    position: null,
    guest1Name: "Ana López",
    guest1Instagram: "ana.lopez",
    guest2Name: null,
    guest2Instagram: null,
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

function waitingEntry(overrides: Partial<EventGuestRow> = {}): EventGuestRow {
  return guestRow({
    kind: "WAITLIST_ENTRY",
    number: 7,
    position: 2,
    status: "WAITING",
    stage: null,
    ...overrides,
  });
}

describe("guestRowData identity", () => {
  it("keys the row by kind and id so a reservation and an entry never collide", () => {
    expect(guestRowData(guestRow()).key).toBe(`RESERVATION-${requestId}`);
    expect(guestRowData(waitingEntry()).key).toBe(`WAITLIST_ENTRY-${requestId}`);
  });

  it("formats a reservation number with three digits", () => {
    expect(guestRowData(guestRow({ number: 4 })).numberLabel).toBe("#004");
    expect(guestRowData(guestRow({ number: 128 })).numberLabel).toBe("#128");
  });

  it("shows a dash for a request that never got a number", () => {
    const rejected = guestRow({ number: null, status: "FULL_REJECTED", stage: null });

    expect(guestRowData(rejected).numberLabel).toBe("-");
  });

  it("shows the rank of a waiting entry in the queue", () => {
    expect(guestRowData(waitingEntry({ position: 2 })).numberLabel).toBe("Cola #2");
  });

  it("shows only the queue for a removed entry that has no rank any more", () => {
    const removed = waitingEntry({ status: "CANCELLED", position: null });

    expect(guestRowData(removed).numberLabel).toBe("Cola");
  });
});

describe("guestRowData guests", () => {
  it("lists one guest with an Instagram profile link", () => {
    expect(guestRowData(guestRow()).guests).toEqual([
      {
        name: "Ana López",
        instagram: "ana.lopez",
        profileHref: "https://www.instagram.com/ana.lopez/",
      },
    ]);
  });

  it("lists both guests of a couple in order", () => {
    const couple = guestRow({
      partySize: 2,
      guest2Name: "Luis Pérez",
      guest2Instagram: "luis_perez",
    });

    expect(guestRowData(couple).guests).toEqual([
      {
        name: "Ana López",
        instagram: "ana.lopez",
        profileHref: "https://www.instagram.com/ana.lopez/",
      },
      {
        name: "Luis Pérez",
        instagram: "luis_perez",
        profileHref: "https://www.instagram.com/luis_perez/",
      },
    ]);
  });

  it("names the guests for the confirmations", () => {
    expect(guestNames(guestRow())).toEqual(["Ana López"]);
    expect(guestNames(guestRow({ guest2Name: "Luis Pérez" }))).toEqual(["Ana López", "Luis Pérez"]);
  });

  it("labels the party size in Spanish", () => {
    expect(guestRowData(guestRow({ partySize: 1 })).partyLabel).toBe("1 persona");
    expect(guestRowData(guestRow({ partySize: 2 })).partyLabel).toBe("2 personas");
  });

  it("passes the allergies and the notes through", () => {
    const data = guestRowData(guestRow({ allergies: "Maní", notes: "Llega tarde" }));

    expect(data.allergies).toBe("Maní");
    expect(data.notes).toBe("Llega tarde");
    expect(guestRowData(guestRow()).allergies).toBeNull();
    expect(guestRowData(guestRow()).notes).toBeNull();
  });

  it("formats the submitted date in the El Salvador time zone", () => {
    expect(guestRowData(guestRow()).submittedLabel).toBe("30/10/2026 19:05");
  });
});

describe("guestRowData status", () => {
  it.each([
    {
      case: "a reservation in review",
      row: guestRow({ stage: "IN_REVIEW" }),
      expected: { label: "Por revisar", variant: "open" },
    },
    {
      case: "a reservation on the list",
      row: guestRow({ stage: "ON_LIST" }),
      expected: { label: "En la lista", variant: "default" },
    },
    {
      case: "a paid reservation",
      row: guestRow({ stage: "PAID" }),
      expected: { label: "Confirmado", variant: "confirmed" },
    },
    {
      case: "a waiting queue entry",
      row: waitingEntry(),
      expected: { label: "En cola", variant: "waitlist" },
    },
    {
      case: "a rejected reservation",
      row: guestRow({ status: "CANCELLED", releaseReason: "REJECTED" }),
      expected: { label: "Rechazado", variant: "rejected" },
    },
    {
      case: "a cancelled reservation",
      row: guestRow({ status: "CANCELLED", releaseReason: "CANCELLED", stage: "PAID" }),
      expected: { label: "Cancelado", variant: "cancelled" },
    },
    {
      case: "a cancelled reservation without a release reason",
      row: guestRow({ status: "CANCELLED", releaseReason: null }),
      expected: { label: "Cancelado", variant: "cancelled" },
    },
    {
      case: "a removed queue entry",
      row: waitingEntry({ status: "CANCELLED", position: null }),
      expected: { label: "Cancelado", variant: "cancelled" },
    },
    {
      case: "a request that found no space",
      row: guestRow({ status: "FULL_REJECTED", stage: null }),
      expected: { label: "Sin lugar", variant: "inactive" },
    },
  ])("maps $case", ({ row, expected }) => {
    expect(guestRowData(row).status).toEqual(expected);
  });

  it("fails loudly when a reservation holding seats has no stage", () => {
    expect(() => guestRowData(guestRow({ status: "CONFIRMED", stage: null }))).toThrow(
      "A reservation that holds seats needs a stage.",
    );
  });

  it("fails loudly on a status the list never selects", () => {
    expect(() => guestRowData(guestRow({ status: "EXPIRED" }))).toThrow(
      "Unexpected status EXPIRED for a RESERVATION.",
    );
    expect(() => guestRowData(waitingEntry({ status: "PROMOTED" }))).toThrow(
      "Unexpected status PROMOTED for a WAITLIST_ENTRY.",
    );
  });
});

describe("guestRowData extra badge", () => {
  it("shows nothing for an ordinary public request", () => {
    expect(guestRowData(guestRow()).extra).toBeNull();
  });

  it("flags a pending refund as the thing left to do", () => {
    const cancelled = guestRow({ status: "CANCELLED", refundStatus: "PENDING" });

    expect(guestRowData(cancelled).extra).toEqual({
      label: "Reembolso pendiente",
      variant: "cancelled",
    });
  });

  it("shows a refund that is already done", () => {
    const refunded = guestRow({ status: "CANCELLED", refundStatus: "REFUNDED" });

    expect(guestRowData(refunded).extra).toEqual({ label: "Reembolso hecho", variant: "default" });
  });

  it("shows that an admin added the person", () => {
    expect(guestRowData(guestRow({ source: "ADMIN" })).extra).toEqual({
      label: "Agregado por admin",
      variant: "draft",
    });
    expect(guestRowData(waitingEntry({ source: "ADMIN" })).extra).toEqual({
      label: "Agregado por admin",
      variant: "draft",
    });
  });

  it("puts the refund before the admin origin", () => {
    const row = guestRow({ status: "CANCELLED", refundStatus: "PENDING", source: "ADMIN" });

    expect(guestRowData(row).extra?.label).toBe("Reembolso pendiente");
  });
});

describe("guestRowData last message", () => {
  const sentAt = new Date("2026-10-31T02:00:00Z");

  it("shows nothing when no message was sent about the request", () => {
    expect(guestRowData(guestRow()).message).toBeNull();
  });

  it("joins the kind and the delivery status in one chip", () => {
    const row = guestRow({
      lastMessage: { kind: "ON_LIST", status: "SENT", lastError: null, sentAt },
    });

    expect(guestRowData(row).message).toEqual({
      label: "En la lista · Enviado",
      variant: "default",
    });
  });

  it("colors a read message as confirmed", () => {
    const row = guestRow({
      lastMessage: { kind: "PAID", status: "READ", lastError: null, sentAt },
    });

    expect(guestRowData(row).message).toEqual({
      label: "Confirmado · Leído",
      variant: "confirmed",
    });
  });

  it("explains a message that waits for the guest to write first", () => {
    const row = guestRow({
      lastMessage: {
        kind: "REQUEST_RECEIVED",
        status: "WAITING_CONTACT",
        lastError: null,
        sentAt: null,
      },
    });

    expect(guestRowData(row).message).toEqual({
      label: "Formulario recibido · Pendiente: aún no nos escribe",
      variant: "waitlist",
    });
  });

  it("shows the error of a failed message as the tooltip", () => {
    const row = guestRow({
      lastMessage: {
        kind: "LOCATION",
        status: "FAILED",
        lastError: "META_190_463",
        sentAt: null,
      },
    });

    expect(guestRowData(row).message).toEqual({
      label: "Ubicación · No se pudo enviar",
      variant: "rejected",
      title: "META_190_463",
    });
  });

  it("leaves the tooltip out when there is no error", () => {
    const row = guestRow({
      lastMessage: { kind: "PROMOTED", status: "QUEUED", lastError: null, sentAt: null },
    });

    expect(guestRowData(row).message).not.toHaveProperty("title");
  });
});
