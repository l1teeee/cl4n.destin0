import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  image: null as null | { contentType: string; data: Uint8Array },
}));
const publish = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, value: { id: "clue-id" } })),
);
const getImage = vi.hoisted(() => vi.fn(async () => state.image));

vi.mock("@/infrastructure/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () =>
    state.authorized
      ? { authorized: true, session: { admin: { id: "00000000-0000-4000-8000-000000000001" } } }
      : { authorized: false, error: "UNAUTHORIZED" },
  ),
}));
vi.mock("@/application/events/event-clues", () => ({ publishEventClue: publish }));
vi.mock("@/infrastructure/db/repositories/postgres-event-clue-repository", () => ({
  postgresEventClueRepository: { getImageForSlug: getImage },
}));
vi.mock("@/infrastructure/db/repositories/postgres-event-repository", () => ({
  postgresEventRepository: {},
}));

const { POST } = await import("@/app/admin/(protected)/events/[id]/clues/route");
const { GET } = await import("@/app/pistas/[slug]/imagenes/[imageId]/route");
const eventId = "00000000-0000-4000-8000-000000000010";
const imageId = "00000000-0000-4000-8000-000000000011";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function postRequest(imageBytes: Uint8Array = png): Request {
  const formData = new FormData();
  formData.set("body", "Mira al fondo.");
  formData.append("images", new File([imageBytes.slice().buffer as ArrayBuffer], "clue.png"));
  return new Request(`http://localhost/admin/events/${eventId}/clues`, {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: formData,
  });
}

beforeEach(() => {
  state.authorized = true;
  state.image = null;
  publish.mockClear();
  getImage.mockClear();
});

describe("event clue image routes", () => {
  it("publishes text and magic-byte-validated images", async () => {
    const response = await POST(postRequest(), { params: Promise.resolve({ id: eventId }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "clue-id" });
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        eventId,
        body: "Mira al fondo.",
        actorId: "00000000-0000-4000-8000-000000000001",
        images: [{ contentType: "image/png", data: expect.any(Buffer) }],
      }),
    );
  });

  it("rejects unauthorized and cross-origin writes", async () => {
    state.authorized = false;
    expect((await POST(postRequest(), { params: Promise.resolve({ id: eventId }) })).status).toBe(
      401,
    );
    state.authorized = true;
    const request = postRequest();
    request.headers.set("origin", "https://attacker.example");
    expect((await POST(request, { params: Promise.resolve({ id: eventId }) })).status).toBe(403);
  });

  it("rejects non-image data and serves slug-scoped no-store image bytes", async () => {
    const invalid = await POST(postRequest(new Uint8Array([1, 2, 3])), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(invalid.status).toBe(415);

    state.image = { contentType: "image/png", data: png };
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: `event-${randomUUID()}`, imageId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(getImage).toHaveBeenCalledWith(expect.stringContaining("event-"), imageId);
  });
});
