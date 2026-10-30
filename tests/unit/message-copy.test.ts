import { describe, expect, it } from "vitest";

import {
  instagramChatHref,
  instagramProfileHref,
  messageKindLabel,
  messageKinds,
  messageStatusCopy,
  messageStatuses,
  windowCopy,
} from "@/ui/admin/messages/message-copy";

const CLOSED_WINDOW_COPY =
  "La ventana de 24 horas está cerrada: lo que envíes saldrá cuando la persona vuelva a escribir. También puedes copiarlo y enviarlo desde Instagram.";

describe("message statuses", () => {
  it("lists exactly the nine delivery states", () => {
    expect(messageStatuses).toEqual([
      "WAITING_CONTACT",
      "WAITING_WINDOW",
      "QUEUED",
      "SENT",
      "READ",
      "FAILED",
      "SENT_MANUALLY",
      "DISCARDED",
      "RECEIVED",
    ]);
  });

  it.each([
    ["WAITING_CONTACT", "Pendiente: aún no nos escribe", "waitlist"],
    ["WAITING_WINDOW", "Pendiente: ventana cerrada", "waitlist"],
    ["QUEUED", "Enviando", "draft"],
    ["SENT", "Enviado", "default"],
    ["READ", "Leído", "confirmed"],
    ["FAILED", "No se pudo enviar", "rejected"],
    ["SENT_MANUALLY", "Enviado a mano", "default"],
    ["DISCARDED", "Descartado", "inactive"],
    ["RECEIVED", "Recibido", "default"],
  ] as const)("describes %s", (status, label, variant) => {
    expect(messageStatusCopy(status)).toEqual({ label, variant });
  });

  it("describes every listed status", () => {
    for (const status of messageStatuses) {
      expect(messageStatusCopy(status).label).not.toBe("");
    }
  });
});

describe("message kinds", () => {
  it("lists exactly the thirteen message kinds", () => {
    expect(messageKinds).toEqual([
      "REQUEST_RECEIVED",
      "WAITLISTED",
      "PROMOTED",
      "ON_LIST",
      "PAID",
      "REJECTED",
      "CANCELLED_UNPAID",
      "CANCELLED_PAID",
      "REFUNDED",
      "LOCATION",
      "CLUE",
      "FREE_TEXT",
      "INBOUND",
    ]);
  });

  it.each([
    ["REQUEST_RECEIVED", "Formulario recibido"],
    ["WAITLISTED", "En la cola"],
    ["PROMOTED", "Entró desde la cola"],
    ["ON_LIST", "En la lista"],
    ["PAID", "Confirmado"],
    ["REJECTED", "No seleccionado"],
    ["CANCELLED_UNPAID", "Cancelación"],
    ["CANCELLED_PAID", "Cancelación con reembolso"],
    ["REFUNDED", "Reembolso"],
    ["LOCATION", "Ubicación"],
    ["CLUE", "Pista"],
    ["FREE_TEXT", "Mensaje"],
    ["INBOUND", "Mensaje recibido"],
  ] as const)("labels %s", (kind, label) => {
    expect(messageKindLabel(kind)).toBe(label);
  });
});

describe("windowCopy", () => {
  it("names the closing time in El Salvador when the window is open", () => {
    const closesAt = new Date("2026-11-03T20:30:00.000Z");

    expect(windowCopy({ open: true, closesAt })).toBe(
      "Puedes escribirle hasta las 14:30 del 3 de noviembre",
    );
  });

  it("uses the El Salvador calendar day instead of the UTC day", () => {
    const closesAt = new Date("2026-11-04T03:15:00.000Z");

    expect(windowCopy({ open: true, closesAt })).toBe(
      "Puedes escribirle hasta las 21:15 del 3 de noviembre",
    );
  });

  it("pads the hour and keeps the day without a leading zero", () => {
    const closesAt = new Date("2026-12-01T12:05:00.000Z");

    expect(windowCopy({ open: true, closesAt })).toBe(
      "Puedes escribirle hasta las 06:05 del 1 de diciembre",
    );
  });

  it("explains the closed window with and without a known closing time", () => {
    expect(windowCopy({ open: false, closesAt: null })).toBe(CLOSED_WINDOW_COPY);
    expect(windowCopy({ open: false, closesAt: new Date("2026-11-03T20:30:00.000Z") })).toBe(
      CLOSED_WINDOW_COPY,
    );
  });

  it("fails loudly when an open window has no closing time", () => {
    expect(() => windowCopy({ open: true, closesAt: null })).toThrow(
      "An open reply window needs the time it closes.",
    );
  });
});

describe("Instagram links", () => {
  it("builds the direct chat link", () => {
    expect(instagramChatHref("clan.destino")).toBe("https://ig.me/m/clan.destino");
  });

  it("builds the profile link", () => {
    expect(instagramProfileHref("clan.destino")).toBe("https://www.instagram.com/clan.destino/");
  });

  it("encodes characters that could change the link path", () => {
    expect(instagramChatHref("a/b?c")).toBe("https://ig.me/m/a%2Fb%3Fc");
    expect(instagramProfileHref("a/b?c")).toBe("https://www.instagram.com/a%2Fb%3Fc/");
  });
});
