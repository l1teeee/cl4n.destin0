import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const countUnreadConversations = vi.fn();
const repository = { countUnreadConversations };

vi.mock("@/infrastructure/auth/require-admin", () => ({ requireAdmin }));
vi.mock("@/infrastructure/db/repositories/postgres-message-repository", () => ({
  postgresMessageRepository: repository,
}));

const { GET } = await import("@/app/api/admin/unread/route");

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });
  countUnreadConversations.mockReset();
});

describe("admin unread route", () => {
  it("rejects requests without an admin session", async () => {
    const response = await GET();

    expect(response.status).toBe(401);
    expect(countUnreadConversations).not.toHaveBeenCalled();
  });

  it("returns the unread conversation count without caching", async () => {
    requireAdmin.mockResolvedValue({ authorized: true, session: { admin: { id: "admin" } } });
    countUnreadConversations.mockResolvedValue(4);

    const response = await GET();

    expect(requireAdmin).toHaveBeenCalledWith("route");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ count: 4 });
  });
});
