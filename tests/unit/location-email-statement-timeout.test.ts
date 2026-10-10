import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";

function poolFailingWith(code: string): Pool {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("UPDATE events")) throw Object.assign(new Error("timeout"), { code });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

const loaded = { revision: 1, status: "CONFIRMED" as const };

describe("PostgresEventLocationEmailRepository.queue timeouts", () => {
  it.each(["55P03", "57014"])("maps SQLSTATE %s to TRY_AGAIN", async (code) => {
    const repository = new PostgresEventLocationEmailRepository(poolFailingWith(code));
    expect(await repository.queue("event-id", loaded, "admin-id")).toEqual({
      ok: false,
      error: "TRY_AGAIN",
    });
  });

  it("rethrows other database errors", async () => {
    const repository = new PostgresEventLocationEmailRepository(poolFailingWith("23505"));
    await expect(repository.queue("event-id", loaded, "admin-id")).rejects.toThrow("timeout");
  });
});
