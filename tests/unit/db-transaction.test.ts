import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { inTransaction } from "@/infrastructure/db/transaction";

function transactionFakes(rollbackError?: Error) {
  const release = vi.fn();
  const query = vi.fn(async (statement: string) => {
    if (statement === "ROLLBACK" && rollbackError) throw rollbackError;
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { pool, query, release };
}

describe("inTransaction", () => {
  it("rethrows the work error and destroys the client when rollback also fails", async () => {
    const originalError = new Error("work failed");
    const rollbackError = new Error("rollback failed");
    const { pool, release } = transactionFakes(rollbackError);

    await expect(
      inTransaction(pool, [], async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(release).toHaveBeenCalledWith(rollbackError);
  });

  it("rethrows the work error and normally releases after a successful rollback", async () => {
    const originalError = new Error("work failed");
    const { pool, query, release } = transactionFakes();

    await expect(
      inTransaction(pool, [], async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
    expect(release.mock.calls[0]?.[0]).toBeUndefined();
  });
});
