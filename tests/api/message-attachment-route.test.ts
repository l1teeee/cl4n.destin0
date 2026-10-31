import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const getAttachment = vi.fn();

vi.mock("@/infrastructure/auth/require-admin", () => ({ requireAdmin }));
vi.mock("@/infrastructure/db/repositories/postgres-message-repository", () => ({
  postgresMessageRepository: { getAttachment },
}));

const { GET } = await import("@/app/admin/(protected)/mensajes/adjuntos/[id]/route");
const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });
  getAttachment.mockReset();
});

describe("message attachment route", () => {
  it("requires an admin", async () => {
    const response = await GET(new Request("http://localhost/attachment"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(401);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it("serves stored bytes without caching or sniffing", async () => {
    requireAdmin.mockResolvedValue({ authorized: true, session: { admin: { id: "admin" } } });
    getAttachment.mockResolvedValue({ contentType: "image/png", data: Buffer.from([1, 2, 3]) });
    const response = await GET(new Request("http://localhost/attachment"), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
