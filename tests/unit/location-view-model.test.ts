import { describe, expect, it } from "vitest";

import type { EventRosterRow } from "@/application/events/types";
import {
  locationMap,
  locationSendButtonLabel,
  locationSendConfirmation,
  rosterLocationCell,
} from "@/ui/admin/view-model";

describe("roster location cell", () => {
  const sentAt = new Date("2026-10-05T18:30:00Z");

  function row(overrides: Partial<EventRosterRow>): EventRosterRow {
    return { kind: "RESERVATION", locationEmail: null, ...overrides } as EventRosterRow;
  }

  function email(status: "SENT" | "PENDING" | "FAILED", isUpdate = false, current = true) {
    return { status, isUpdate, sentAt: status === "SENT" ? sentAt : null, current };
  }

  it.each([
    [row({}), "No enviada", false],
    [row({ locationEmail: email("SENT") }), "Enviada 05/10/2026 12:30", false],
    [row({ locationEmail: email("SENT", true) }), "Actualización enviada 05/10/2026 12:30", false],
    [row({ locationEmail: email("PENDING") }), "En envío", false],
    [row({ locationEmail: email("FAILED") }), "Falló", true],
    [row({ locationEmail: email("SENT", false, false) }), "Desactualizada", false],
    [row({ kind: "WAITLIST_ENTRY" }), "-", false],
  ])("labels case %#", (input, text, failed) => {
    expect(rosterLocationCell(input)).toMatchObject({ text, failed });
  });

  it("explains an outdated location in the title", () => {
    expect(rosterLocationCell(row({ locationEmail: email("SENT", false, false) })).title).toBe(
      "Recibió una ubicación anterior",
    );
  });
});

describe("location send texts", () => {
  it.each([
    [3, 0, "Enviar ubicación a 3"],
    [0, 2, "Enviar actualización a 2"],
    [3, 2, "Enviar ubicación (3 por primera vez, 2 actualizaciones)"],
    [0, 0, null],
  ])("labels the button for %i first-time and %i updates", (firstTime, updates, label) => {
    expect(locationSendButtonLabel(firstTime, updates)).toBe(label);
  });

  it("builds the confirmation for first-time, update and mixed sends", () => {
    const first = "Se enviará la ubicación por primera vez a 3 personas con reserva confirmada.";
    const update = "2 personas recibieron una ubicación anterior y recibirán la actualización.";
    const auto =
      "Después de este envío, quien se confirme, incluso desde la cola, recibirá la ubicación automáticamente.";
    expect(locationSendConfirmation(3, 0)).toBe(`${first} ${auto} No se puede deshacer.`);
    expect(locationSendConfirmation(0, 2)).toBe(`${update} ${auto} No se puede deshacer.`);
    expect(locationSendConfirmation(3, 2)).toBe(`${first} ${update} ${auto} No se puede deshacer.`);
  });
});

describe("location map", () => {
  it("points at the exact coordinates when known", () => {
    expect(
      locationMap({ name: "Casa", address: "Calle 1", latitude: 13.69, longitude: -89.21 }),
    ).toEqual({
      src: "https://www.google.com/maps?q=13.69,-89.21&z=17&output=embed",
      caption: "Punto exacto del enlace de Google Maps.",
    });
  });

  it("falls back to the address with newlines flattened", () => {
    const map = locationMap({
      name: "Casa",
      address: "Calle 1\nColonia",
      latitude: null,
      longitude: null,
    });
    expect(map?.src).toBe(
      `https://www.google.com/maps?q=${encodeURIComponent("Casa, Calle 1, Colonia")}&output=embed`,
    );
    expect(map?.caption).toContain("Ubicación aproximada");
  });

  it("returns null without coordinates or address", () => {
    expect(
      locationMap({ name: "Casa", address: null, latitude: null, longitude: null }),
    ).toBeNull();
  });
});
