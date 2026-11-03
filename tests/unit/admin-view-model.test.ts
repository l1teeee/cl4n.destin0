import { describe, expect, it } from "vitest";

import type { AdminEventSummary } from "@/application/events/types";
import {
  adminStatusBadgeVariant,
  auditPageSizeFor,
  dashboardActions,
  dashboardGuestColumns,
  editEventBackLink,
  eventPhaseLabel,
  eventSections,
  formatAdminDate,
  formatAuditMetadata,
  formatCount,
  formatReservationNumber,
  lifecycleActions,
  emailErrorLabel,
  emailKindLabel,
  emailStatusBadgeVariant,
  emailStatusLabel,
  parseEmailLogSearchParams,
  parseAuditSearchParams,
  parseEventSection,
  parseReservationSearchParams,
  publicEventUrl,
  publicLinkHint,
  reservationStatusLabel,
} from "@/ui/admin/view-model";

const now = new Date("2026-10-05T12:00:00Z");

describe("public event link", () => {
  it("builds an absolute encoded URL with or without a trailing slash", () => {
    expect(publicEventUrl("https://clandestino.example", "cena privada")).toBe(
      "https://clandestino.example/solicitar/cena%20privada",
    );
    expect(publicEventUrl("https://clandestino.example/", "cena/uno")).toBe(
      "https://clandestino.example/solicitar/cena%2Funo",
    );
  });

  it.each([
    ["DRAFT", "Borrador: el enlace no funciona hasta que publiques la experiencia."],
    ["SCHEDULED", "El enlace mostrará el formulario cerrado hasta que abra."],
    ["OPEN", null],
    ["WAITLIST", null],
    ["FULL", "Sin cupos: el enlace mostrará que no hay lugares."],
    ["CLOSED", "El formulario ya cerró: el enlace mostrará el estado cerrado."],
    ["COMPLETED", "El formulario ya cerró: el enlace mostrará el estado cerrado."],
    ["CANCELLED", "El formulario ya cerró: el enlace mostrará el estado cerrado."],
  ] as const)("returns the %s phase hint", (phase, expected) => {
    expect(publicLinkHint(phase)).toBe(expected);
  });
});

function event(overrides: Partial<AdminEventSummary>): AdminEventSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    internalName: "Cena",
    slug: "cena",
    startsAt: new Date("2026-11-01T01:00:00Z"),
    capacity: 20,
    reservedSeats: 0,
    maxPartySize: 4,
    opensAt: new Date("2026-10-10T12:00:00Z"),
    closesAt: new Date("2026-10-20T12:00:00Z"),
    autoCloseOnFull: false,
    waitlistCapacity: 0,
    waitlistedCount: 0,
    paymentInstructions: null,
    priceCents: null,
    status: "DRAFT",
    location: {
      name: null,
      address: null,
      mapsUrl: null,
      wazeUrl: null,
      notes: null,
      status: "PENDING",
      confirmedAt: null,
      latitude: null,
      longitude: null,
    },
    locationRevision: 0,
    locationReleasedRevision: null,
    phase: "DRAFT",
    availableSeats: 20,
    confirmedReservationCount: 0,
    inReviewCount: 0,
    onListCount: 0,
    paidCount: 0,
    queueCount: 0,
    ...overrides,
  };
}

describe("event phase labels", () => {
  it("labels the waitlist-only phase in Spanish and keeps other phases", () => {
    expect(eventPhaseLabel("WAITLIST")).toBe("Solo cola");
    expect(eventPhaseLabel("OPEN")).toBe("OPEN");
  });

  it("treats a waitlist-only event like an open one for dashboard actions", () => {
    expect(dashboardActions(event({ status: "SCHEDULED", phase: "WAITLIST" }), now)).toEqual([
      "CLOSE_NOW",
      "EDIT",
      "RESERVATIONS",
    ]);
  });
});

describe("admin dashboard actions", () => {
  it("shows only phase-valid dashboard actions", () => {
    expect(dashboardActions(event({}), now)).toEqual([
      "OPEN_NOW",
      "EDIT",
      "RESERVATIONS",
      "DELETE",
    ]);
    expect(dashboardActions(event({ status: "SCHEDULED", phase: "OPEN" }), now)).toEqual([
      "CLOSE_NOW",
      "EDIT",
      "RESERVATIONS",
    ]);
    expect(dashboardActions(event({ status: "SCHEDULED", phase: "FULL" }), now)).toEqual([
      "CLOSE_NOW",
      "EDIT",
      "RESERVATIONS",
    ]);
    expect(dashboardActions(event({ status: "COMPLETED", phase: "COMPLETED" }), now)).toEqual([
      "EDIT",
      "RESERVATIONS",
      "DELETE",
    ]);
  });

  it("builds lifecycle actions for each stored state", () => {
    expect(lifecycleActions(event({}), now)).toEqual(["PUBLISH", "OPEN_NOW", "CANCEL"]);
    expect(lifecycleActions(event({ status: "SCHEDULED", phase: "OPEN" }), now)).toEqual([
      "CLOSE_NOW",
      "CANCEL",
    ]);
    expect(
      lifecycleActions(
        event({
          status: "SCHEDULED",
          phase: "CLOSED",
          closesAt: new Date("2026-10-05T11:59:00Z"),
        }),
        now,
      ),
    ).toEqual(["REOPEN", "CANCEL"]);
    expect(lifecycleActions(event({ status: "CLOSED", phase: "CLOSED" }), now)).toEqual([
      "REOPEN",
      "COMPLETE",
      "CANCEL",
    ]);
    expect(lifecycleActions(event({ status: "CANCELLED", phase: "CANCELLED" }), now)).toEqual([]);
  });

  it.each(["CLOSED", "SCHEDULED"] as const)(
    "offers REOPEN for %s when the closing date equals database time",
    (status) => {
      const actions = lifecycleActions(event({ status, phase: "CLOSED", closesAt: now }), now);
      expect(actions).toContain("REOPEN");
      expect(actions).not.toContain("OPEN_NOW");
    },
  );

  it.each(["CLOSED", "SCHEDULED"] as const)(
    "does not reopen %s once the dinner has started",
    (status) => {
      for (const startsAt of [now, new Date(now.getTime() - 1)]) {
        const actions = lifecycleActions(
          event({ status, phase: "CLOSED", startsAt, closesAt: new Date(now.getTime() - 1) }),
          now,
        );
        expect(actions).not.toContain("REOPEN");
      }
    },
  );
});

describe("event detail sections", () => {
  it("opens the guest list by default and for unknown values", () => {
    expect(parseEventSection(undefined, true)).toBe("invitados");
    expect(parseEventSection("", true)).toBe("invitados");
    expect(parseEventSection("desconocida", true)).toBe("invitados");
  });

  it("keeps the old reservaciones id working as an alias of invitados", () => {
    expect(parseEventSection("reservaciones", false)).toBe("invitados");
    expect(parseEventSection("reservaciones", true)).toBe("invitados");
    expect(parseEventSection("invitados", false)).toBe("invitados");
  });

  it.each(["economia", "ubicacion", "gestion", "auditoria"] as const)(
    "opens the %s section",
    (section) => {
      expect(parseEventSection(section, false)).toBe(section);
    },
  );

  it("opens the clues section only while the clues are visible", () => {
    expect(parseEventSection("pistas", true)).toBe("pistas");
    expect(parseEventSection("pistas", false)).toBe("invitados");
  });

  it("reads only the first value of a repeated parameter", () => {
    expect(parseEventSection(["gestion", "auditoria"], false)).toBe("gestion");
    expect(parseEventSection(["reservaciones", "gestion"], false)).toBe("invitados");
  });

  it("lists Invitados first and adds Pistas only while the clues are visible", () => {
    expect(eventSections(false).map((section) => section.label)).toEqual([
      "Invitados",
      "Economía",
      "Ubicación",
      "Gestión",
      "Auditoría",
    ]);
    expect(eventSections(true).map((section) => [section.id, section.label])).toEqual([
      ["invitados", "Invitados"],
      ["pistas", "Pistas"],
      ["economia", "Economía"],
      ["ubicacion", "Ubicación"],
      ["gestion", "Gestión"],
      ["auditoria", "Auditoría"],
    ]);
  });
});

describe("dashboard guest columns", () => {
  it("replaces the seat counters with the occupancy, the three stages and the queue", () => {
    expect(dashboardGuestColumns.map((column) => column.heading)).toEqual([
      "Ocupados",
      "Por revisar",
      "En la lista",
      "Confirmados",
      "Cola",
    ]);
  });

  it("renders the counts of an event", () => {
    const summary = event({
      capacity: 20,
      reservedSeats: 12,
      inReviewCount: 3,
      onListCount: 5,
      paidCount: 4,
      queueCount: 2,
      waitlistCapacity: 5,
    });

    expect(dashboardGuestColumns.map((column) => column.value(summary))).toEqual([
      "12/20",
      "3",
      "5",
      "4",
      "2 / 5",
    ]);
  });
});

describe("admin formatting and query parsing", () => {
  it("formats location, stage, changed fields and other metadata", () => {
    expect(formatAuditMetadata({ locationMessagesQueued: 1, locationRevision: 2 })).toBe(
      "Ubicación enviada (versión 2) a 1 persona",
    );
    expect(formatAuditMetadata({ locationMessagesQueued: 2, locationRevision: 3 })).toBe(
      "Ubicación enviada (versión 3) a 2 personas",
    );
    expect(formatAuditMetadata({ locationMessagesQueued: 0, locationRevision: 3 })).toBe(
      "Ubicación (versión 3): nadie pendiente de recibirla",
    );
    expect(formatAuditMetadata({ stage: "IN_REVIEW", partySize: 1 })).toBe(
      "Etapa: Por revisar · 1 persona",
    );
    expect(formatAuditMetadata({ stage: "ON_LIST", partySize: 2 })).toBe(
      "Etapa: En la lista · 2 personas",
    );
    expect(formatAuditMetadata({ stage: "PAID" })).toBe("Etapa: Pago verificado");
    expect(formatAuditMetadata({ stage: "OTHER" })).toBe("Etapa: OTHER");
    expect(formatAuditMetadata({ changedFields: ["nombre", "fecha"] })).toBe(
      "Campos cambiados: nombre, fecha",
    );
    expect(formatAuditMetadata({ eventId: "123", nombre: "Ana", count: 2 })).toBe(
      "nombre: Ana · count: 2",
    );
    expect(formatAuditMetadata({ reservationId: "123" })).toBe("-");
  });
  it("formats clue audit metadata", () => {
    expect(formatAuditMetadata({ clueAdded: "clue-1" })).toBe("Pista publicada: clue-1");
    expect(formatAuditMetadata({ clueRemoved: "clue-2" })).toBe("Pista eliminada: clue-2");
  });

  it("formats dates, counts, and reservation numbers", () => {
    expect(formatAdminDate(new Date("2026-11-21T01:30:00Z"))).toBe("20/11/2026 19:30");
    expect(formatAdminDate(null)).toBe("-");
    expect(formatReservationNumber(7)).toBe("#007");
    expect(formatReservationNumber(null)).toBe("-");
    expect(formatCount(1234)).toMatch(/1.234|1,234/);
    expect(reservationStatusLabel("FULL_REJECTED")).toBe("Rechazada por capacidad");
  });

  it("allow-lists reservation query values", () => {
    expect(
      parseReservationSearchParams({
        q: "  Ana  ",
        status: "CONFIRMED",
        sort: "number",
        dir: "asc",
      }),
    ).toEqual({ q: "Ana", status: "CONFIRMED", sort: "number", direction: "asc" });
    expect(
      parseReservationSearchParams({
        status: "DROP TABLE reservations",
        sort: "submitted_at; DELETE",
        dir: "sideways",
      }),
    ).toEqual({ sort: "submittedAt", direction: "desc" });
  });

  it("allow-lists audit filters and positive pages", () => {
    expect(parseAuditSearchParams({ entityType: "EVENT", page: "2" })).toEqual({
      entityType: "EVENT",
      page: 2,
    });
    expect(parseAuditSearchParams({ entityType: "UNKNOWN", page: "-1" })).toEqual({ page: 1 });
  });

  it("uses five audit rows on phones and ten elsewhere", () => {
    expect(auditPageSizeFor("mobile")).toBe(5);
    expect(auditPageSizeFor("tablet")).toBe(10);
    expect(auditPageSizeFor(undefined)).toBe(10);
  });

  it("maps status and email labels and allow-lists their filters", () => {
    expect(adminStatusBadgeVariant("ACTIVE")).toBe("active");
    expect(adminStatusBadgeVariant("INACTIVE")).toBe("inactive");
    expect(adminStatusBadgeVariant("OPEN")).toBe("open");
    expect(adminStatusBadgeVariant("WAITLIST")).toBe("waitlist");
    expect(adminStatusBadgeVariant("DRAFT")).toBe("draft");
    expect(adminStatusBadgeVariant("CLOSED")).toBe("closed");
    expect(adminStatusBadgeVariant("CANCELLED")).toBe("cancelled");
    expect(adminStatusBadgeVariant("SCHEDULED")).toBe("default");
    expect(adminStatusBadgeVariant("FULL")).toBe("default");
    expect(adminStatusBadgeVariant("COMPLETED")).toBe("default");
    expect(emailStatusLabel("FAILED")).toBe("Falló");
    expect(emailStatusBadgeVariant("SENT")).toBe("confirmed");
    expect(emailKindLabel("ADMIN_SIGNED_IN")).toBe("Inicio de sesión");
    expect(emailKindLabel("EVENT_LOCATION")).toBe("Ubicación del evento");
    expect(emailErrorLabel("LOCATION_SUPERSEDED")).toBe("Existe una ubicación más reciente");
    expect(emailErrorLabel("KIND_RETIRED")).toBe(
      "Los avisos a invitados ahora se envían por Instagram",
    );
    expect(parseEmailLogSearchParams({ estado: "FAILED", tipo: "RESERVATION_CONFIRMED" })).toEqual({
      status: "FAILED",
      kind: "RESERVATION_CONFIRMED",
    });
    expect(parseEmailLogSearchParams({ estado: "INVALID", tipo: "INVALID" })).toEqual({});
  });
});

describe("edit event back link", () => {
  const eventId = "00000000-0000-4000-8000-000000000001";
  const toExperiences = { href: "/admin", label: "Volver a experiencias" };
  const toDetail = { href: `/admin/events/${eventId}`, label: "Volver al detalle" };

  it("returns to the experiences list when the edit page was opened from it", () => {
    expect(editEventBackLink(eventId, "experiencias")).toEqual(toExperiences);
  });

  it("returns to the event detail when there is no origin", () => {
    expect(editEventBackLink(eventId, undefined)).toEqual(toDetail);
  });

  it("reads only the first value of a repeated origin", () => {
    expect(editEventBackLink(eventId, ["experiencias", "desconocido"])).toEqual(toExperiences);
    expect(editEventBackLink(eventId, ["desconocido", "experiencias"])).toEqual(toDetail);
  });

  it("returns to the event detail for an unknown origin", () => {
    expect(editEventBackLink(eventId, "desconocido")).toEqual(toDetail);
  });
});
