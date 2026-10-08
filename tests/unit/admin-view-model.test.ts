import { describe, expect, it } from "vitest";

import type { AdminEventSummary } from "@/application/events/types";
import {
  adminStatusBadgeVariant,
  dashboardActions,
  eventPhaseLabel,
  formatAdminDate,
  formatCount,
  formatReservationNumber,
  lifecycleActions,
  emailKindLabel,
  emailStatusBadgeVariant,
  emailStatusLabel,
  parseEmailLogSearchParams,
  parseRosterView,
  parseAuditSearchParams,
  parseReservationSearchParams,
  reservationStatusLabel,
  rosterStatusLabel,
  rosterStatusBadgeVariant,
} from "@/ui/admin/view-model";

const now = new Date("2026-10-05T12:00:00Z");

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
    status: "DRAFT",
    phase: "DRAFT",
    availableSeats: 20,
    confirmedReservationCount: 0,
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
    expect(dashboardActions(event({}), now)).toEqual(["OPEN_NOW", "EDIT", "RESERVATIONS"]);
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
    ]);
  });

  it("builds lifecycle actions for each stored state", () => {
    expect(lifecycleActions(event({}), now)).toEqual(["PUBLISH", "OPEN_NOW", "CANCEL"]);
    expect(lifecycleActions(event({ status: "SCHEDULED", phase: "OPEN" }), now)).toEqual([
      "CLOSE_NOW",
      "CANCEL",
    ]);
    expect(lifecycleActions(event({ status: "CLOSED", phase: "CLOSED" }), now)).toEqual([
      "OPEN_NOW",
      "COMPLETE",
      "CANCEL",
    ]);
    expect(lifecycleActions(event({ status: "CANCELLED", phase: "CANCELLED" }), now)).toEqual([]);
  });
});

describe("admin formatting and query parsing", () => {
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

  it("maps roster and email labels and allow-lists their filters", () => {
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
    expect(rosterStatusLabel("PROMOTED")).toBe("Promovida");
    expect(rosterStatusBadgeVariant("REJECTED")).toBe("rejected");
    expect(emailStatusLabel("FAILED")).toBe("Falló");
    expect(emailStatusBadgeVariant("SENT")).toBe("confirmed");
    expect(emailKindLabel("ADMIN_SIGNED_IN")).toBe("Inicio de sesión");
    expect(parseRosterView("en-cola", "confirmadas")).toBe("en-cola");
    expect(parseRosterView("invalida", "confirmadas")).toBe("confirmadas");
    expect(parseEmailLogSearchParams({ estado: "FAILED", tipo: "RESERVATION_CONFIRMED" })).toEqual({
      status: "FAILED",
      kind: "RESERVATION_CONFIRMED",
    });
    expect(parseEmailLogSearchParams({ estado: "INVALID", tipo: "INVALID" })).toEqual({});
  });
});
