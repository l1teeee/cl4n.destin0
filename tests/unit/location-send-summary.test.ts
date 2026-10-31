import { describe, expect, it } from "vitest";

import { describeLocationSend } from "@/app/admin/(protected)/events/location-send-summary";
import type { MessageStatus } from "@/domain/messaging/message-types";

function describeOutcomes(statuses: readonly MessageStatus[]): string {
  const ids = statuses.map((_, index) => `message-${index}`);
  const outcomes = Object.fromEntries(ids.map((id, index) => [id, statuses[index]!]));
  return describeLocationSend(ids, outcomes);
}

describe("describeLocationSend", () => {
  it("says when nobody needed the location", () => {
    expect(describeLocationSend([], {})).toBe(
      "Todas las personas confirmadas ya tienen la ubicación actual.",
    );
  });

  it("reports the people reached and the ones waiting for the 24 hour window", () => {
    expect(
      describeOutcomes([
        "SENT",
        "SENT",
        "SENT",
        "SENT",
        "SENT",
        "WAITING_WINDOW",
        "WAITING_WINDOW",
      ]),
    ).toBe(
      "Ubicación enviada a 5 personas. 2 quedaron pendientes porque no nos han escrito en las últimas 24 horas.",
    );
  });

  it("uses the singular forms for one person", () => {
    expect(describeOutcomes(["SENT", "WAITING_WINDOW"])).toBe(
      "Ubicación enviada a 1 persona. 1 quedó pendiente porque no nos ha escrito en las últimas 24 horas.",
    );
  });

  it("counts read and manually sent messages as reached", () => {
    expect(describeOutcomes(["READ", "SENT_MANUALLY"])).toBe("Ubicación enviada a 2 personas.");
  });

  it("explains guests whose conversation is not linked yet", () => {
    expect(describeOutcomes(["SENT", "WAITING_CONTACT", "WAITING_CONTACT"])).toBe(
      "Ubicación enviada a 1 persona. 2 quedaron pendientes porque aún no vinculamos su conversación de Instagram.",
    );
    expect(describeOutcomes(["WAITING_CONTACT"])).toBe(
      "Todavía nadie recibió la ubicación. 1 quedó pendiente porque aún no vinculamos su conversación de Instagram.",
    );
  });

  it("reports messages still queued, failed or discarded", () => {
    expect(describeOutcomes(["SENT", "QUEUED", "QUEUED", "FAILED", "DISCARDED"])).toBe(
      "Ubicación enviada a 1 persona. 2 se enviarán en unos minutos. 1 no se pudo enviar; revísalo en Mensajes. 1 se descartó porque ya no corresponde.",
    );
    expect(describeOutcomes(["QUEUED", "FAILED", "FAILED", "DISCARDED", "DISCARDED"])).toBe(
      "Todavía nadie recibió la ubicación. 1 se enviará en unos minutos. 2 no se pudieron enviar; revísalos en Mensajes. 2 se descartaron porque ya no corresponden.",
    );
  });

  it("ignores ids that have no outcome", () => {
    expect(describeLocationSend(["known", "unknown"], { known: "SENT" })).toBe(
      "Ubicación enviada a 1 persona.",
    );
  });
});
