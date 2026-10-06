import type { Pool, PoolClient } from "pg";

const rollbackResult = Symbol("rollbackResult");

interface RollbackResult<T> {
  [rollbackResult]: true;
  value: T;
}

export function rollbackTransaction<T>(value: T): RollbackResult<T> {
  return { [rollbackResult]: true, value };
}

function isRollbackResult<T>(value: T | RollbackResult<T>): value is RollbackResult<T> {
  return typeof value === "object" && value !== null && rollbackResult in value;
}

export async function inTransaction<T>(
  pool: Pool,
  settings: readonly string[],
  work: (client: PoolClient) => Promise<T | RollbackResult<T>>,
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | boolean | undefined;

  try {
    await client.query("BEGIN");
    for (const setting of settings) {
      await client.query(setting);
    }
    const result = await work(client);
    if (isRollbackResult(result)) {
      await client.query("ROLLBACK");
      return result.value;
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : true;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
