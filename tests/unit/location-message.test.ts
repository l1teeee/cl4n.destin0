import { describe, expect, it } from "vitest";

import {
  composeLocationText,
  fitsInMessageBody,
  MAX_LOCATION_PHOTOS,
  MAX_MESSAGE_BODY_LENGTH,
  MAX_MESSAGE_PARTS,
} from "@/domain/messaging/location-message";
import { clueImageUrl, locationPhotoUrl } from "@/domain/messaging/message-attachment-urls";
import { splitIntoChunks } from "@/domain/messaging/text-chunks";

describe("composeLocationText", () => {
  it("puts name, address, notes and the Maps link on one line each", () => {
    expect(
      composeLocationText({
        name: "Casa Secreta",
        address: "Calle 1, San Salvador",
        notes: "Toca el timbre",
        mapsUrl: "https://maps.google.com/?q=casa",
      }),
    ).toBe(
      "Casa Secreta\nCalle 1, San Salvador\nToca el timbre\nGoogle Maps: https://maps.google.com/?q=casa",
    );
  });

  it("skips missing and blank parts", () => {
    expect(
      composeLocationText({ name: null, address: "Calle 1", notes: "   ", mapsUrl: null }),
    ).toBe("Calle 1");
    expect(composeLocationText({ name: null, address: null, notes: null, mapsUrl: null })).toBe("");
  });

  it("labels both providers and supports a Waze-only location", () => {
    expect(
      composeLocationText({
        name: null,
        address: null,
        notes: null,
        mapsUrl: "https://maps.app.goo.gl/place",
        wazeUrl: "https://waze.com/ul?ll=1,2",
      }),
    ).toBe("Google Maps: https://maps.app.goo.gl/place\nWaze: https://waze.com/ul?ll=1,2");
    expect(
      composeLocationText({
        name: null,
        address: null,
        notes: null,
        mapsUrl: null,
        wazeUrl: "https://waze.com/ul",
      }),
    ).toBe("Waze: https://waze.com/ul");
  });

  it("keeps the line breaks that the notes already contain", () => {
    expect(
      composeLocationText({
        name: null,
        address: "Calle 1",
        notes: "Entrada lateral\nPregunta por el clan",
        mapsUrl: null,
      }),
    ).toBe("Calle 1\nEntrada lateral\nPregunta por el clan");
  });
});

describe("fitsInMessageBody", () => {
  it("accepts a body of exactly the limit and rejects one character more", () => {
    expect(MAX_MESSAGE_BODY_LENGTH).toBe(2000);
    expect(fitsInMessageBody("a".repeat(2000))).toBe(true);
    expect(fitsInMessageBody("a".repeat(2001))).toBe(false);
  });

  it("counts characters like PostgreSQL does, so an astral character counts once", () => {
    const astral = String.fromCodePoint(0x1f600);

    expect(astral.length).toBe(2);
    expect(fitsInMessageBody(astral.repeat(2000))).toBe(true);
    expect(fitsInMessageBody(astral.repeat(2001))).toBe(false);
  });

  it("counts the photos as parts next to the text chunks and rejects more than 20 parts", () => {
    const twoChunks = "a".repeat(1500);

    expect(splitIntoChunks(twoChunks)).toHaveLength(2);
    expect(MAX_MESSAGE_PARTS).toBe(20);
    expect(fitsInMessageBody(twoChunks, 18)).toBe(true);
    expect(fitsInMessageBody(twoChunks, 19)).toBe(false);
    expect(fitsInMessageBody("a".repeat(1000), MAX_LOCATION_PHOTOS)).toBe(true);
  });
});

describe("message attachment URLs", () => {
  it("builds a venue photo URL from the public token", () => {
    expect(locationPhotoUrl("https://clandestino.example", "token43")).toBe(
      "https://clandestino.example/ubicacion/foto/token43",
    );
  });

  it("does not double the slash of a base URL that ends with one", () => {
    expect(locationPhotoUrl("https://clandestino.example/", "token43")).toBe(
      "https://clandestino.example/ubicacion/foto/token43",
    );
    expect(clueImageUrl("https://clandestino.example//", "cena", "image-1")).toBe(
      "https://clandestino.example/pistas/cena/imagenes/image-1",
    );
  });

  it("encodes the slug and image id of a clue image URL", () => {
    expect(clueImageUrl("http://localhost:3000", "cena privada", "a/b")).toBe(
      "http://localhost:3000/pistas/cena%20privada/imagenes/a%2Fb",
    );
  });
});
