import { describe, expect, it } from "vitest";

import { eventLocationEmail } from "@/infrastructure/email/templates/event-location-email";

const baseInput = {
  fullName: "Ana Pérez",
  reservationNumber: 12,
  partySize: 3,
  eventStartsAt: new Date("2026-11-14T02:00:00.000Z"),
  locationName: "Casa Secreta",
  locationAddress: "Calle 1, San Salvador",
  locationMapsUrl: "https://maps.google.com/?q=casa",
  locationNotes: "Toca el timbre\nPregunta por <Clan>",
  imageTokens: ["a".repeat(43), "B".repeat(43)],
  appBaseUrl: "https://clandestino.example",
  isUpdate: false,
};

describe("eventLocationEmail", () => {
  it("uses the first-send subject and heading", () => {
    const email = eventLocationEmail(baseInput);
    expect(email.subject).toBe("El clan revela el lugar");
    expect(email.html).toContain("Este es el lugar");
    expect(email.text).not.toContain("Esta ubicación reemplaza");
  });

  it("uses the update subject, heading and notice", () => {
    const email = eventLocationEmail({ ...baseInput, isUpdate: true });
    expect(email.subject).toBe("Cambio de lugar: nueva ubicación");
    expect(email.html).toContain("El lugar cambió");
    expect(email.text).toContain("Esta ubicación reemplaza la que te enviamos antes.");
  });

  it("escapes names, addresses and multiline directions in html", () => {
    const email = eventLocationEmail({
      ...baseInput,
      fullName: "<Ana & Luz>",
      locationAddress: "Calle <1> & Avenida",
    });
    expect(email.html).toContain("&lt;Ana &amp; Luz&gt;");
    expect(email.html).toContain("Calle &lt;1&gt; &amp; Avenida");
    expect(email.html).toContain("Pregunta por &lt;Clan&gt;");
    expect(email.html).toContain("Toca el timbre<br>Pregunta");
    expect(email.html).not.toContain("<Ana & Luz>");
  });

  it("falls back to a Google Maps search URL", () => {
    const email = eventLocationEmail({ ...baseInput, locationMapsUrl: null });
    const url = "https://www.google.com/maps/search/?api=1&query=Calle%201%2C%20San%20Salvador";
    expect(email.html).toContain(url.replace("&", "&amp;"));
    expect(email.text).toContain(url);
  });

  it("builds image URLs from APP_BASE_URL and omits images from text", () => {
    const email = eventLocationEmail({ ...baseInput, appBaseUrl: "https://app.example/" });
    expect(email.html).toContain(`https://app.example/ubicacion/foto/${"a".repeat(43)}`);
    expect(email.html).toContain(`https://app.example/ubicacion/foto/${"B".repeat(43)}`);
    expect(email.html.match(/<img /g)).toHaveLength(2);
    expect(email.text).not.toContain("<img");
    expect(email.text).not.toContain("/ubicacion/foto/");
  });
});
