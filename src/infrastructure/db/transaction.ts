import type { Pool, PoolClient } from "pg";

export async function inTransaction<T>(
  pool: Pool,
  settings: readonly string[],
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | boolean | undefined;

  try {
    await client.query("BEGIN");
    for (const setting of settings) {
      await client.query(setting);
    }
    const result = await work(client);
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
