import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresLocationMessageRepository } from "@/infrastructure/db/repositories/postgres-location-message-repository";

function poolFailingOnEventLock(code: string): Pool {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) throw Object.assign(new Error("timeout"), { code });
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
}

const loaded = { revision: 1, status: "CONFIRMED" as const };

describe("PostgresLocationMessageRepository.sendLocationToPaidGuests timeouts", () => {
  it.each(["55P03", "57014"])("maps SQLSTATE %s to TRY_AGAIN", async (code) => {
    const repository = new PostgresLocationMessageRepository(poolFailingOnEventLock(code));

    expect(await repository.sendLocationToPaidGuests("event-id", loaded, "admin-id")).toEqual({
      ok: false,
      error: "TRY_AGAIN",
    });
  });

  it.each(["23505", "40P01", "ECONNREFUSED"])(
    "rethrows the database error %s instead of calling it a busy event",
    async (code) => {
      const repository = new PostgresLocationMessageRepository(poolFailingOnEventLock(code));

      await expect(
        repository.sendLocationToPaidGuests("event-id", loaded, "admin-id"),
      ).rejects.toThrow("timeout");
    },
  );
});
