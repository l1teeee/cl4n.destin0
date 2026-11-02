import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-staged-guest-migrations-"));
  cpSync(path.resolve("drizzle"), directory, { recursive: true });
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const target = journal.entries.find((entry) => entry.tag === tag);
  if (!target) throw new Error(`Migration ${tag} not found`);
  for (const entry of journal.entries.filter((entry) => entry.idx >= target.idx)) {
    rmSync(path.join(directory, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < target.idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}

async function maintenance(work: (client: Client) => Promise<void>): Promise<void> {
  const url = testDatabaseUrl();
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

describe("migration 0013 staged guest flow and messaging", () => {
  it("migrates legacy rows, seeds templates and enforces the new checks", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_staged_guest_flow`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0013_staged_guest_flow_messaging");

    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const event = await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, reserved_seats, max_party_size,
           opens_at, closes_at, waitlisted_count
         ) VALUES (
           'migration-0013', 'Migration 0013', now() + interval '2 days', 10, 1, 2,
           now() - interval '1 day', now() + interval '1 day', 1
         ) RETURNING id`,
      );
      const eventId = event.rows[0]!.id;
      const acceptedAt = new Date("2026-10-30T12:00:00.000Z");
      const rows = await pool.query<{ id: string; status: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, terms_accepted_at,
           idempotency_key, submitted_at, accepted_at, cancelled_at
         ) VALUES
           ($1, 1, 'CONFIRMED', 'Legacy Confirmed', 'legacy.confirmed', '+50370000001',
            'confirmed@example.com', 'confirmed@example.com', 1, now(), $2, now(), $5, NULL),
           ($1, 2, 'CANCELLED', 'Legacy Cancelled', 'legacy.cancelled', '+50370000002',
            'cancelled@example.com', 'cancelled@example.com', 1, now(), $3, now(), now(), now()),
           ($1, NULL, 'FULL_REJECTED', 'Legacy Rejected', 'legacy.rejected', '+50370000003',
            'rejected@example.com', 'rejected@example.com', 1, now(), $4, now(), NULL, NULL)
         RETURNING id, status`,
        [eventId, randomUUID(), randomUUID(), randomUUID(), acceptedAt],
      );
      await pool.query(
        `INSERT INTO waitlist_entries (
           event_id, waitlist_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, terms_accepted_at,
           idempotency_key, submitted_at
         ) VALUES (
           $1, 1, 'WAITING', 'Legacy Waiting', 'legacy.waiting', '+50370000004',
           'waiting@example.com', 'waiting@example.com', 1, now(), $2, now()
         )`,
        [eventId, randomUUID()],
      );

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const confirmedId = rows.rows.find((row) => row.status === "CONFIRMED")!.id;
      const cancelledId = rows.rows.find((row) => row.status === "CANCELLED")!.id;
      const backfill = await pool.query<{
        id: string;
        stage: string;
        on_list_at: Date | null;
        paid_at: Date | null;
        release_reason: string | null;
      }>(
        `SELECT id, stage, on_list_at, paid_at, release_reason
           FROM reservations
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[confirmedId, cancelledId]],
      );
      const confirmed = backfill.rows.find((row) => row.id === confirmedId)!;
      const cancelled = backfill.rows.find((row) => row.id === cancelledId)!;
      expect(confirmed).toMatchObject({ stage: "PAID", release_reason: null });
      expect(confirmed.on_list_at?.toISOString()).toBe(acceptedAt.toISOString());
      expect(confirmed.paid_at?.toISOString()).toBe(acceptedAt.toISOString());
      expect(cancelled.release_reason).toBe("CANCELLED");

      const templates = await pool.query<{ key: string; body: string }>(
        "SELECT key, body FROM message_templates ORDER BY key",
      );
      expect(templates.rows).toEqual(
        [
          [
            "CANCELLED_PAID",
            "Hola, {nombre}. Lamentablemente tu lugar para la experiencia del {fecha} se ha cancelado. Lo sentimos mucho. Te devolveremos el pago y te avisaremos por aquí cuando esté hecho.",
          ],
          [
            "CANCELLED_UNPAID",
            "Hola, {nombre}. Tu lugar para la experiencia del {fecha} quedó cancelado. Esperamos verte en una próxima experiencia.",
          ],
          [
            "LOCATION",
            "Esta es la ubicación de la experiencia del {fecha}:\n\n{ubicacion}\n\nNo la compartas con nadie.",
          ],
          [
            "ON_LIST",
            "¡Felicidades, {nombre}, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.\n\n{pago}\n\nCuando transfieras, envíanos el comprobante por aquí.",
          ],
          [
            "PAID",
            "¡Felicidades, {nombre}! Tu lugar está confirmado para la experiencia del {fecha}. Por aquí te enviaremos las pistas y la ubicación. El día de la experiencia escríbenos para recibirlas a tiempo.",
          ],
          [
            "PROMOTED",
            "¡Buenas noticias, {nombre}! Se liberó un lugar y ya estás en el listado de la experiencia del {fecha}. Te confirmaremos por aquí para saber si estás en la lista.",
          ],
          [
            "REFUNDED",
            "Hola, {nombre}. Ya realizamos la devolución de tu pago. Gracias por tu paciencia; esperamos verte pronto.",
          ],
          [
            "REJECTED",
            "Hola, {nombre}. Gracias por tu interés en Clandestino. Esta vez no pudimos darte un lugar, pero esperamos verte en una próxima experiencia.",
          ],
          [
            "REQUEST_RECEIVED",
            "¡Felicidades, {nombre}! Completaste el formulario para la experiencia del {fecha}. Te confirmaremos por aquí para saber si estás en la lista.",
          ],
          [
            "WAITLISTED",
            "Hola, {nombre}. Completaste el formulario, pero el cupo ya se llenó: quedaste en la cola en la posición {posicion}. Si se libera un lugar te escribiremos por aquí.",
          ],
        ].map(([key, body]) => ({ key, body })),
      );

      await expect(
        pool.query(
          `UPDATE reservations
              SET guest2_full_name = 'Guest Two', guest2_instagram_handle = NULL
            WHERE id = $1`,
          [confirmedId],
        ),
      ).rejects.toMatchObject({ constraint: "reservations_guest2_pair_chk" });
      await expect(
        pool.query(
          `UPDATE waitlist_entries
              SET guest2_full_name = 'Guest Two', guest2_instagram_handle = 'guest.two'
            WHERE event_id = $1`,
          [eventId],
        ),
      ).rejects.toMatchObject({ constraint: "waitlist_entries_guest2_party_chk" });
      await expect(
        pool.query("UPDATE reservations SET link_code = 'ABC123' WHERE id = $1", [confirmedId]),
      ).rejects.toMatchObject({ constraint: "reservations_link_code_chk" });
      await expect(
        pool.query("UPDATE reservations SET refund_status = 'PENDING' WHERE id = $1", [
          confirmedId,
        ]),
      ).rejects.toMatchObject({ constraint: "reservations_refund_status_chk" });

      const contact = await pool.query<{ id: string }>(
        `INSERT INTO messaging_contacts (instagram_scoped_id)
         VALUES ('123456789')
         RETURNING id`,
      );
      await expect(
        pool.query(
          `INSERT INTO messages (id, contact_id, direction, kind, source, status, body)
           VALUES (gen_random_uuid(), $1, 'INBOUND', 'FREE_TEXT', 'GUEST', 'RECEIVED', 'hola')`,
          [contact.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ constraint: "messages_inbound_kind_chk" });
      await expect(
        pool.query(
          `INSERT INTO messages (id, direction, kind, source, status, body)
           VALUES (gen_random_uuid(), 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'RECEIVED', 'hola')`,
        ),
      ).rejects.toMatchObject({ constraint: "messages_inbound_status_chk" });
      await expect(
        pool.query(
          `INSERT INTO messages (id, direction, kind, source, status, body)
           VALUES (gen_random_uuid(), 'OUTBOUND', 'FREE_TEXT', 'GUEST', 'WAITING_CONTACT', 'hola')`,
        ),
      ).rejects.toMatchObject({ constraint: "messages_inbound_source_chk" });
      await expect(
        pool.query(
          `INSERT INTO messages (id, direction, kind, source, status, body)
           VALUES (gen_random_uuid(), 'OUTBOUND', 'LOCATION', 'SYSTEM', 'WAITING_CONTACT', 'lugar')`,
        ),
      ).rejects.toMatchObject({ constraint: "messages_location_revision_chk" });
      await expect(
        pool.query(
          `INSERT INTO messages (
             id, direction, kind, source, status, attachment_urls
           ) VALUES (
             gen_random_uuid(), 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'WAITING_CONTACT',
             ARRAY['1','2','3','4','5','6','7','8','9','10','11']
           )`,
        ),
      ).rejects.toMatchObject({ constraint: "messages_attachment_urls_chk" });

      const message = await pool.query<{ id: string }>(
        `INSERT INTO messages (id, direction, kind, source, status, body)
         VALUES (gen_random_uuid(), 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'WAITING_CONTACT', 'recibo')
         RETURNING id`,
      );
      await expect(
        pool.query(
          `INSERT INTO message_attachments (
             id, message_id, position, content_type, byte_size, data
           ) VALUES (gen_random_uuid(), $1, 10, 'image/png', 1, decode('00', 'hex'))`,
          [message.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ constraint: "message_attachments_position_chk" });
      await expect(
        pool.query(
          `INSERT INTO message_attachments (
             id, message_id, position, content_type, byte_size, data
           ) VALUES (gen_random_uuid(), $1, 0, 'image/png', 0, decode('', 'hex'))`,
          [message.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ constraint: "message_attachments_byte_size_chk" });

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const defaultedMessage = await pool.query<{ id: string }>(
        `INSERT INTO messages (direction, kind, source, status, body)
         VALUES ('OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'WAITING_CONTACT', 'sin id explicito')
         RETURNING id`,
      );
      const defaultedAttachment = await pool.query<{ id: string }>(
        `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
         VALUES ($1, 0, 'image/png', 1, decode('00', 'hex'))
         RETURNING id`,
        [defaultedMessage.rows[0]!.id],
      );
      expect(defaultedMessage.rows[0]!.id).toMatch(uuidPattern);
      expect(defaultedAttachment.rows[0]!.id).toMatch(uuidPattern);
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 20_000);
});
