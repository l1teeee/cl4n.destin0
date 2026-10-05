import { pathToFileURL } from "node:url";

import { Pool } from "pg";

import { hashPassword } from "../src/infrastructure/auth/password.ts";

const DEV_ADMIN_EMAIL = "admin@clandestino.local";
const DEV_ADMIN_PASSWORD = "ClandestinoLocal-2026";
const DEMO_EVENT_SLUG = "cena-clandestino-demo";

export function assertLocalDatabaseUrl(databaseUrlValue: string): URL {
  const databaseUrl = new URL(databaseUrlValue);
  if (databaseUrl.hostname !== "127.0.0.1" && databaseUrl.hostname !== "localhost") {
    throw new Error("Seed rechazado: DATABASE_URL debe apuntar a 127.0.0.1 o localhost");
  }
  return databaseUrl;
}

export async function seedDatabase(
  databaseUrlValue: string,
  log: (message: string) => void = console.log,
): Promise<void> {
  const databaseUrl = assertLocalDatabaseUrl(databaseUrlValue);
  log(`Destino: ${databaseUrl.hostname}:${databaseUrl.port || "5432"}${databaseUrl.pathname}`);
  const pool = new Pool({ connectionString: databaseUrlValue, ssl: false });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existingAdmin = await client.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email_normalized = $1",
      [DEV_ADMIN_EMAIL],
    );
    let adminId = existingAdmin.rows[0]?.id;
    if (adminId) {
      log("El administrador local ya existe; no se modifico.");
    } else {
      const insertedAdmin = await client.query<{ id: string }>(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
         VALUES ($1, $1, $2, 'Admin Local')
         RETURNING id`,
        [DEV_ADMIN_EMAIL, await hashPassword(DEV_ADMIN_PASSWORD)],
      );
      adminId = insertedAdmin.rows[0]!.id;
      log("Se creo el administrador local.");
    }

    const insertedEvent = await client.query<{ id: string }>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       INSERT INTO events (
         internal_name,
         slug,
         starts_at,
         capacity,
         max_party_size,
         opens_at,
         closes_at,
         auto_close_on_full,
         status
       )
       SELECT
         'Cena Clandestino Demo',
         $1,
         db_clock.db_now + INTERVAL '15 days',
         20,
         2,
         db_clock.db_now - INTERVAL '1 hour',
         db_clock.db_now + INTERVAL '14 days',
         false,
         'SCHEDULED'
       FROM db_clock
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE slug = $1)
       RETURNING id`,
      [DEMO_EVENT_SLUG],
    );
    const eventId = insertedEvent.rows[0]?.id;
    if (eventId) {
      await client.query(
        `INSERT INTO audit_logs (
           actor_type,
           actor_admin_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES ('ADMIN', $1, 'EVENT_CREATED', 'EVENT', $2, '{"status":"SCHEDULED"}')`,
        [adminId, eventId],
      );
      log(`Se creó el evento de demostración ${DEMO_EVENT_SLUG}.`);
    } else {
      log(`El evento ${DEMO_EVENT_SLUG} ya existe; no se modificó.`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseUrlValue = process.env.DATABASE_URL;
  if (!databaseUrlValue) {
    console.error("DATABASE_URL es obligatoria");
    process.exitCode = 1;
  } else {
    seedDatabase(databaseUrlValue).catch(() => {
      console.error("No se pudo ejecutar el seed.");
      process.exitCode = 1;
    });
  }
}
