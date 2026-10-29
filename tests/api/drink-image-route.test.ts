import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  image: null as null | { id: string; contentType: string; data: Uint8Array },
}));

const getImage = vi.hoisted(() => vi.fn(async () => state.image));

vi.mock("@/infrastructure/db/repositories/postgres-drink-repository", () => ({
  postgresDrinkRepository: { getImage },
}));

const { GET } = await import("@/app/bebidas/imagen/[imageId]/route");
const imageId = "00000000-0000-4000-8000-000000000010";
const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

beforeEach(() => {
  state.image = null;
  getImage.mockClear();
});

describe("public drink image route", () => {
  it("serves bytes with immutable caching headers", async () => {
    state.image = { id: imageId, contentType: "image/webp", data: bytes };
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ imageId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("returns 404 before repository access for a malformed id", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ imageId: "bad" }),
    });
    expect(response.status).toBe(404);
    expect(getImage).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown image", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ imageId }),
    });
    expect(response.status).toBe(404);
    expect(getImage).toHaveBeenCalledWith(imageId);
  });
});
