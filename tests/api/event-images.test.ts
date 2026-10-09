import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  images: new Map<string, { eventId: string; data: Buffer; id: string }>(),
}));

vi.mock("@/infrastructure/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () =>
    state.authorized
      ? {
          authorized: true,
          session: { admin: { id: "00000000-0000-4000-8000-000000000001" } },
        }
      : { authorized: false, error: "UNAUTHORIZED" },
  ),
}));

vi.mock("@/infrastructure/db/repositories/postgres-event-image-repository", () => ({
  postgresEventImageRepository: {
    add: vi.fn(async (input: { eventId: string; data: Buffer }) => {
      const id = randomUUID();
      state.images.set(id, { eventId: input.eventId, data: input.data, id });
      return {
        ok: true,
        value: {
          id,
          contentType: "image/webp",
          byteSize: input.data.length,
          createdAt: new Date(),
        },
      };
    }),
    get: vi.fn(async (eventId: string, imageId: string) => {
      const image = state.images.get(imageId);
      return image?.eventId === eventId
        ? {
            id: image.id,
            contentType: "image/webp",
            byteSize: image.data.length,
            createdAt: new Date(),
            data: image.data,
          }
        : null;
    }),
  },
}));

const { POST } = await import("@/app/admin/(protected)/events/[id]/images/route");
const { GET } = await import("@/app/admin/(protected)/events/[id]/images/[imageId]/route");

const eventId = "00000000-0000-4000-8000-000000000010";
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function postRequest(bytes: Uint8Array = webp, headers: HeadersInit = {}): Request {
  const formData = new FormData();
  formData.set(
    "image",
    new File([bytes.slice().buffer as ArrayBuffer], "venue.webp", {
      type: "application/octet-stream",
    }),
  );
  return new Request(`http://localhost/admin/events/${eventId}/images`, {
    method: "POST",
    headers: { origin: "http://localhost", ...headers },
    body: formData,
  });
}

beforeEach(() => {
  state.authorized = true;
  state.images.clear();
});

describe("admin event image routes", () => {
  it("returns 401 without an admin session", async () => {
    state.authorized = false;
    const response = await POST(postRequest(), { params: Promise.resolve({ id: eventId }) });
    expect(response.status).toBe(401);
  });

  it.each([undefined, "https://evil.example"])("returns 403 for origin %s", async (origin) => {
    const request = postRequest();
    if (origin) request.headers.set("origin", origin);
    else request.headers.delete("origin");
    const response = await POST(request, { params: Promise.resolve({ id: eventId }) });
    expect(response.status).toBe(403);
  });

  it("returns 413 before reading an oversized request", async () => {
    const response = await POST(postRequest(webp, { "content-length": "2621441" }), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(413);
  });

  it("returns 415 for bytes that are not an image", async () => {
    const response = await POST(postRequest(new TextEncoder().encode("not-an-image")), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(415);
  });

  it("uploads WebP and serves the same private bytes", async () => {
    const uploaded = await POST(postRequest(), { params: Promise.resolve({ id: eventId }) });
    expect(uploaded.status).toBe(201);
    const { id } = (await uploaded.json()) as { id: string };

    const served = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: eventId, imageId: id }),
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(served.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(webp);
  });

  it("returns 401 for GET without a session", async () => {
    state.authorized = false;
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: eventId, imageId: randomUUID() }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 when the image belongs to another event", async () => {
    const uploaded = await POST(postRequest(), { params: Promise.resolve({ id: eventId }) });
    const { id } = (await uploaded.json()) as { id: string };
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: randomUUID(), imageId: id }),
    });
    expect(response.status).toBe(404);
  });
});
