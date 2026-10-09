import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  image: null as null | { contentType: "image/webp"; data: Uint8Array },
}));

const getByPublicToken = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/db/repositories/postgres-event-image-repository", () => ({
  postgresEventImageRepository: {
    getByPublicToken: getByPublicToken.mockImplementation(async () =>
      state.image
        ? {
            id: "image-1",
            contentType: state.image.contentType,
            byteSize: state.image.data.byteLength,
            data: state.image.data,
            createdAt: new Date(),
          }
        : null,
    ),
  },
}));

const { GET } = await import("@/app/ubicacion/foto/[token]/route");
const token = "A".repeat(43);

beforeEach(() => {
  state.image = null;
  getByPublicToken.mockClear();
});

describe("public event location photo route", () => {
  it("returns bytes and public privacy headers without a session", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    state.image = { contentType: "image/webp", data: bytes };

    const response = await GET(new Request(`http://localhost/ubicacion/foto/${token}`), {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("returns 404 before database access for a malformed token", async () => {
    const response = await GET(new Request("http://localhost/ubicacion/foto/bad"), {
      params: Promise.resolve({ token: "bad" }),
    });
    expect(response.status).toBe(404);
    expect(getByPublicToken).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown token", async () => {
    const response = await GET(new Request(`http://localhost/ubicacion/foto/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(404);
    expect(getByPublicToken).toHaveBeenCalledWith(token);
  });
});
