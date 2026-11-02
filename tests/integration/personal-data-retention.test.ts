import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import {
  purgeExpiredPersonalData,
  purgeExpiredUnattributedPersonalData,
} from "@/application/privacy/purge-expired-personal-data";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { env } from "@/infrastructure/config/env";
import { pool as applicationPool } from "@/infrastructure/db/client";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { PostgresPersonalDataRetentionRepository } from "@/infrastructure/db/repositories/postgres-personal-data-retention-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import * as logger from "@/infrastructure/observability/logger";

import {
  insertAdminUser,
  insertGuestReservation,
  openEventLock,
  waitUntilSomeoneIsBlocked,
} from "../helpers/guest-flow-test-data";
import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresPersonalDataRetentionRepository;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresPersonalDataRetentionRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await applicationPool.end();
});

async function oldEvent(days: number, deleted = false): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
       status, deleted_at
     ) VALUES ($1, 'Retention', now() - $2 * interval '1 day', 50, 2,
               now() - interval '100 days', now() - interval '99 days',
               'COMPLETED', CASE WHEN $3 THEN now() END)
     RETURNING id`,
    [`retention-${randomUUID()}`, days, deleted],
  );
  return result.rows[0]!.id;
}

async function contact(): Promise<string> {
  sequence += 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messaging_contacts (instagram_scoped_id, username, display_name)
     VALUES ($1, $2, 'Nombre privado del contacto') RETURNING id`,
    [String(800_000_000 + sequence), `private.contact.${sequence}`],
  );
  return result.rows[0]!.id;
}

async function waitlist(eventId: string, contactId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, phone_e164, email, email_normalized,
       party_size, notes, allergies, terms_accepted_at, link_code,
       contact_id, contact_linked_by, idempotency_key, submitted_at
     ) VALUES ($1, 1, 'WAITING', 'Nombre privado', 'private.waitlist',
               'Acompañante privado', 'private.companion', '+50370000002',
               'private.waitlist@example.com', 'private.waitlist@example.com',
               2, 'Observaciones privadas', 'Alergias privadas', now(), $3,
               $2, 'MANUAL', gen_random_uuid(), now()) RETURNING id`,
    [eventId, contactId, generateLinkCode()],
  );
  await pool.query(
    "UPDATE events SET waitlisted_count = 1, last_waitlist_number = 1 WHERE id = $1",
    [eventId],
  );
  return result.rows[0]!.id;
}

async function message(input: {
  eventId?: string;
  reservationId?: string;
  waitlistEntryId?: string;
  contactId?: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (
       event_id, reservation_id, waitlist_entry_id, contact_id,
       direction, kind, source, status, body, attachment_urls, last_error
     ) VALUES ($1, $2, $3, $4, 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'FAILED',
               'Mensaje privado', ARRAY['https://example.com/private.png'], 'PRIVATE_ERROR')
     RETURNING id`,
    [input.eventId, input.reservationId, input.waitlistEntryId, input.contactId],
  );
  const id = result.rows[0]!.id;
  await pool.query(
    `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
     VALUES ($1, 0, 'image/png', 1, $2)`,
    [id, Buffer.from([1])],
  );
  return id;
}

async function inboundMessage(contactId: string, receivedDaysAgo: number): Promise<string> {
  const id = await message({ contactId });
  await pool.query(
    `UPDATE messages
        SET direction = 'INBOUND', kind = 'INBOUND', source = 'GUEST', status = 'RECEIVED',
            received_at = now() - $2 * interval '1 day',
            created_at = now() - interval '120 days'
      WHERE id = $1`,
    [id, receivedDaysAgo],
  );
  return id;
}

async function oldContact(lastInboundDaysAgo: number | null = null): Promise<string> {
  const id = await contact();
  await pool.query(
    `UPDATE messaging_contacts
        SET created_at = now() - interval '91 days',
            last_inbound_at = now() - $2 * interval '1 day'
      WHERE id = $1`,
    [id, lastInboundDaysAgo],
  );
  return id;
}

const erasedFields = {
  full_name: "eliminado",
  guest2_full_name: null,
  guest2_instagram_handle: null,
  phone_e164: null,
  email: null,
  email_normalized: null,
  notes: null,
  allergies: null,
  link_code: null,
  contact_id: null,
  contact_linked_by: null,
};

describe("personal data retention", () => {
  it("anonymizes a 91-day-old deleted event atomically and preserves rows, counts and shared contacts", async () => {
    const eventId = await oldEvent(91, true);
    const recentEventId = await oldEvent(89);
    const shared = await contact();
    const exclusive = await contact();
    const waitingContact = await contact();
    const messageContact = await contact();
    const protectedByMessage = await contact();
    const unrelatedContact = await contact();
    const solo = await insertGuestReservation(pool, eventId, { contactId: exclusive });
    await insertGuestReservation(pool, eventId, {
      contactId: shared,
      guest2FullName: "Acompañante privado",
    });
    const cancelled = await insertGuestReservation(pool, eventId, { status: "CANCELLED" });
    await pool.query("UPDATE reservations SET release_reason = 'CANCELLED' WHERE id = $1", [
      cancelled,
    ]);
    const recent = await insertGuestReservation(pool, recentEventId, { contactId: shared });
    await pool.query(
      `UPDATE reservations
          SET phone_e164 = '+50370000000', email = 'private@example.com',
              email_normalized = 'private@example.com', notes = 'Notas privadas',
              allergies = 'Alergias privadas', payment_note = 'Pago privado', link_code = $2
        WHERE id = $1`,
      [solo, generateLinkCode()],
    );
    const entry = await waitlist(eventId, waitingContact);
    const removedMessages = [
      await message({ eventId, contactId: messageContact }),
      await message({ reservationId: solo, contactId: exclusive }),
      await message({ waitlistEntryId: entry, contactId: waitingContact }),
      await message({ eventId, contactId: protectedByMessage }),
    ];
    const keptMessage = await message({ reservationId: recent, contactId: protectedByMessage });
    await pool.query(
      `INSERT INTO idempotency_records (
         key, scope, request_fingerprint, response_status, response_body,
         reservation_id, waitlist_entry_id, completed_at
       ) SELECT idempotency_key, 'reservation_submit', 'private-fingerprint', 200,
                '{"linkCode":"SECRET"}', id, NULL::uuid, now()
           FROM reservations WHERE event_id = $1
         UNION ALL
         SELECT idempotency_key, 'reservation_submit', 'private-fingerprint', 200,
                '{"linkCode":"SECRET"}'::jsonb, NULL::uuid, id, now()
           FROM waitlist_entries WHERE event_id = $1`,
      [eventId],
    );
    // A completed legacy record can be keyed by the request without a subject FK.
    await pool.query(
      "UPDATE idempotency_records SET reservation_id = NULL WHERE reservation_id = $1",
      [solo],
    );
    await pool.query(
      `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, metadata)
       VALUES ('PUBLIC', 'RESERVATION_CREATED', 'RESERVATION', $1,
               '{"fullName":"Historical private name"}'),
              ('PUBLIC', 'RESERVATION_WAITLISTED', 'WAITLIST_ENTRY', $2,
               '{"notes":"Historical private notes"}')`,
      [solo, entry],
    );
    const beforeReservations = await pool.query(
      "SELECT * FROM reservations WHERE event_id = $1 ORDER BY id",
      [eventId],
    );
    const beforeWaitlist = await pool.query("SELECT * FROM waitlist_entries WHERE id = $1", [
      entry,
    ]);
    const beforeEvent = await pool.query("SELECT * FROM events WHERE id = $1", [eventId]);
    const beforeRecent = await pool.query("SELECT * FROM reservations WHERE id = $1", [recent]);
    const beforeContacts = await pool.query(
      "SELECT * FROM messaging_contacts WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[shared, protectedByMessage, unrelatedContact]],
    );
    const beforeAudit = await pool.query("SELECT * FROM audit_logs ORDER BY id");
    const onEventFailure = vi.fn();
    await expect(
      purgeExpiredPersonalData({ repository, onEventFailure }, { limit: 20 }),
    ).resolves.toBe(1);
    expect(onEventFailure).not.toHaveBeenCalled();
    const reservations = await pool.query(
      "SELECT * FROM reservations WHERE event_id = $1 ORDER BY id",
      [eventId],
    );
    expect(reservations.rows).toEqual(
      beforeReservations.rows.map((row) => ({
        ...row,
        ...erasedFields,
        instagram_handle: `eliminado_${row.id.slice(0, 8)}`,
        payment_note: null,
        release_reason: null,
      })),
    );
    expect(
      (await pool.query("SELECT * FROM waitlist_entries WHERE id = $1", [entry])).rows,
    ).toEqual(
      beforeWaitlist.rows.map((row) => ({
        ...row,
        ...erasedFields,
        instagram_handle: `eliminado_${row.id.slice(0, 8)}`,
      })),
    );
    const afterEvent = (await pool.query("SELECT * FROM events WHERE id = $1", [eventId])).rows[0]!;
    expect(afterEvent.personal_data_purged_at).toBeInstanceOf(Date);
    expect(afterEvent).toEqual({
      ...beforeEvent.rows[0],
      personal_data_purged_at: afterEvent.personal_data_purged_at,
    });
    expect((await pool.query("SELECT * FROM reservations WHERE id = $1", [recent])).rows).toEqual(
      beforeRecent.rows,
    );
    expect(
      (
        await pool.query("SELECT personal_data_purged_at FROM events WHERE id = $1", [
          recentEventId,
        ])
      ).rows[0]!.personal_data_purged_at,
    ).toBeNull();
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE id = ANY($1::uuid[])", [removedMessages]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT 1 FROM message_attachments WHERE message_id = ANY($1::uuid[])", [
          removedMessages,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await pool.query("SELECT 1 FROM messages WHERE id = $1", [keptMessage])).rowCount).toBe(
      1,
    );
    expect(
      (await pool.query("SELECT 1 FROM message_attachments WHERE message_id = $1", [keptMessage]))
        .rowCount,
    ).toBe(1);
    expect((await pool.query("SELECT 1 FROM idempotency_records")).rowCount).toBe(0);
    expect((await pool.query("SELECT * FROM messaging_contacts ORDER BY id")).rows).toEqual(
      beforeContacts.rows,
    );
    expect((await pool.query("SELECT * FROM audit_logs ORDER BY id")).rows).toEqual(
      beforeAudit.rows,
    );
    await expect(
      purgeExpiredPersonalData({ repository, onEventFailure }, { limit: 20 }),
    ).resolves.toBe(0);
    await expect(repository.purgeEvent(recentEventId)).resolves.toBe(false);
  });

  it("serializes concurrent purges of one event and only counts it once", async () => {
    const eventId = await oldEvent(91);
    await insertGuestReservation(pool, eventId);
    const holder = await openEventLock(pool, eventId);
    try {
      const first = repository.purgeEvent(eventId);
      const second = repository.purgeEvent(eventId);
      await waitUntilSomeoneIsBlocked(pool);
      await holder.query("COMMIT");
      expect((await Promise.all([first, second])).sort()).toEqual([false, true]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("rolls back deleted messages and attachments if anonymizing a child fails", async () => {
    const eventId = await oldEvent(92);
    const reservationId = await insertGuestReservation(pool, eventId);
    const messageId = await message({ reservationId });
    await pool.query(
      `CREATE FUNCTION retention_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'retention test failure'; END; $$;
       CREATE TRIGGER retention_test_failure BEFORE UPDATE ON reservations
       FOR EACH ROW EXECUTE FUNCTION retention_test_reject()`,
    );
    try {
      await expect(repository.purgeEvent(eventId)).rejects.toThrow("retention test failure");
      expect((await pool.query("SELECT 1 FROM messages WHERE id = $1", [messageId])).rowCount).toBe(
        1,
      );
      expect(
        (await pool.query("SELECT 1 FROM message_attachments WHERE message_id = $1", [messageId]))
          .rowCount,
      ).toBe(1);
      expect(
        (await pool.query("SELECT full_name FROM reservations WHERE id = $1", [reservationId]))
          .rows[0]!.full_name,
      ).toBe("Ana López");
      expect(
        (await pool.query("SELECT personal_data_purged_at FROM events WHERE id = $1", [eventId]))
          .rows[0]!.personal_data_purged_at,
      ).toBeNull();
    } finally {
      await pool.query(
        "DROP TRIGGER retention_test_failure ON reservations; DROP FUNCTION retention_test_reject()",
      );
    }
    await expect(repository.purgeEvent(eventId)).resolves.toBe(true);
  });

  it("selects at most 20 oldest events and uses the database cutoff", async () => {
    const ids: string[] = [];
    for (let days = 91; days <= 111; days += 1) ids.push(await oldEvent(days));
    const expected = ids.toReversed();
    await expect(repository.listDueEventIds(100)).resolves.toEqual(expected.slice(0, 20));
    await expect(repository.listDueEventIds(2)).resolves.toEqual(expected.slice(0, 2));
    await expect(repository.purgeEvent(randomUUID())).resolves.toBe(false);
    const onEventFailure = vi.fn();
    await expect(
      purgeExpiredPersonalData({ repository, onEventFailure }, { limit: 100 }),
    ).resolves.toBe(20);
    await expect(repository.listDueEventIds(20)).resolves.toEqual([ids[0]]);
    await repository.purgeEvent(ids[0]!);
  });

  it("reports a failed event and continues purging the next event", async () => {
    const failed = randomUUID();
    const next = await oldEvent(91);
    const onEventFailure = vi.fn();
    const purgeEvent = vi.fn(async (id: string) => {
      if (id === failed) throw new Error("private error details");
      return repository.purgeEvent(id);
    });
    await expect(
      purgeExpiredPersonalData(
        { repository: { listDueEventIds: async () => [failed, next], purgeEvent }, onEventFailure },
        { limit: 20 },
      ),
    ).resolves.toBe(1);
    expect(onEventFailure).toHaveBeenCalledExactlyOnceWith(failed);
    expect(purgeEvent.mock.calls).toEqual([[failed], [next]]);
  });

  it("authenticates the cron, disables caching and logs counts and per-event failures without PII", async () => {
    const { GET, maxDuration } = await import("@/app/api/cron/retention/route");
    const previousSecret = env.CRON_SECRET;
    const secret = "retention-test-secret-with-32-characters";
    const failedId = await oldEvent(92);
    const successfulId = await oldEvent(91);
    const expiredContact = await oldContact(91);
    const expiredMessage = await inboundMessage(expiredContact, 91);
    const log = vi.spyOn(logger, "log").mockImplementation(() => undefined);
    const purge = vi.spyOn(PostgresPersonalDataRetentionRepository.prototype, "purgeEvent");
    const request = (authorization?: string) =>
      new Request("http://localhost/api/cron/retention", {
        headers: authorization ? { authorization } : {},
      });
    try {
      expect(maxDuration).toBe(60);
      env.CRON_SECRET = secret;
      for (const header of [undefined, "Bearer wrong", `Bearer ${secret.slice(0, -1)}x`, secret]) {
        const response = await GET(request(header));
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
      env.CRON_SECRET = undefined;
      expect((await GET(request(`Bearer ${secret}`))).status).toBe(401);
      expect(purge).not.toHaveBeenCalled();
      env.CRON_SECRET = secret;
      purge.mockRejectedValueOnce(new Error("PRIVATE_BODY"));
      const response = await GET(request(`Bearer ${secret}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        purgedEvents: 1,
        purgedMessages: 1,
        purgedContacts: 1,
      });
      expect(purge.mock.calls).toEqual([[failedId], [successfulId]]);
      expect(log.mock.calls).toEqual([
        ["error", "personal_data_purge_failed", { eventId: failedId }],
        ["info", "personal_data_purged", { events: 1, messages: 1, contacts: 1 }],
      ]);
      expect(
        (await pool.query("SELECT 1 FROM messages WHERE id = $1", [expiredMessage])).rowCount,
      ).toBe(0);
      expect(await (await GET(request(`Bearer ${secret}`))).json()).toEqual({
        purgedEvents: 1,
        purgedMessages: 0,
        purgedContacts: 0,
      });
      expect(await (await GET(request(`Bearer ${secret}`))).json()).toEqual({
        purgedEvents: 0,
        purgedMessages: 0,
        purgedContacts: 0,
      });
    } finally {
      env.CRON_SECRET = previousSecret;
      vi.restoreAllMocks();
    }
  });
});

describe("unattributed personal data retention", () => {
  it("deletes old inbound messages and images, preserving recent messages and contacts still in use", async () => {
    const expiredContact = await oldContact(91);
    const emptyContact = await oldContact();
    const activeContact = await oldContact(91);
    const waitlistContact = await oldContact();
    const recentMessageContact = await oldContact(91);
    const recentInboundContact = await oldContact(10);
    const freshContact = await contact();
    const event = await insertTestEvent(pool, { waitlistCapacity: 5 });
    const reservationId = await insertGuestReservation(pool, event.id, {
      contactId: activeContact,
    });
    await waitlist(event.id, waitlistContact);
    const expiredMessage = await inboundMessage(expiredContact, 91);
    const activeOldMessage = await inboundMessage(activeContact, 91);
    const activeRecentMessage = await inboundMessage(activeContact, 10);
    const recentMessage = await inboundMessage(recentMessageContact, 10);
    const attributedOldMessage = await message({ eventId: event.id, contactId: activeContact });
    await pool.query("UPDATE messages SET received_at = now() - interval '91 days' WHERE id = $1", [
      attributedOldMessage,
    ]);
    const keptMessages = [activeRecentMessage, recentMessage, attributedOldMessage];
    const keptContacts = [
      activeContact,
      waitlistContact,
      recentMessageContact,
      recentInboundContact,
      freshContact,
    ];
    const beforeMessages = await pool.query(
      "SELECT * FROM messages WHERE id = ANY($1::uuid[]) ORDER BY id",
      [keptMessages],
    );
    const beforeAttachments = await pool.query(
      "SELECT * FROM message_attachments WHERE message_id = ANY($1::uuid[]) ORDER BY id",
      [keptMessages],
    );
    const beforeContacts = await pool.query(
      "SELECT * FROM messaging_contacts WHERE id = ANY($1::uuid[]) ORDER BY id",
      [keptContacts],
    );
    const beforeReservation = await pool.query("SELECT * FROM reservations WHERE id = $1", [
      reservationId,
    ]);

    const result = await purgeExpiredUnattributedPersonalData(
      { repository, now: () => 0 },
      { timeBudgetMs: 40_000 },
    );
    expect(result).toEqual({ messages: 2, contacts: 2 });
    expect(
      (
        await pool.query("SELECT 1 FROM messages WHERE id = ANY($1::uuid[])", [
          [expiredMessage, activeOldMessage],
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT 1 FROM message_attachments WHERE message_id = ANY($1::uuid[])", [
          [expiredMessage, activeOldMessage],
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT 1 FROM messaging_contacts WHERE id = ANY($1::uuid[])", [
          [expiredContact, emptyContact],
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query("SELECT * FROM messages WHERE id = ANY($1::uuid[]) ORDER BY id", [
          keptMessages,
        ])
      ).rows,
    ).toEqual(beforeMessages.rows);
    expect(
      (
        await pool.query(
          "SELECT * FROM message_attachments WHERE message_id = ANY($1::uuid[]) ORDER BY id",
          [keptMessages],
        )
      ).rows,
    ).toEqual(beforeAttachments.rows);
    expect(
      (
        await pool.query(
          "SELECT * FROM messaging_contacts WHERE id = ANY($1::uuid[]) ORDER BY id",
          [keptContacts],
        )
      ).rows,
    ).toEqual(beforeContacts.rows);
    expect(
      (await pool.query("SELECT * FROM reservations WHERE id = $1", [reservationId])).rows,
    ).toEqual(beforeReservation.rows);
    await expect(
      purgeExpiredUnattributedPersonalData({ repository }, { timeBudgetMs: 40_000 }),
    ).resolves.toEqual({ messages: 0, contacts: 0 });
  });

  it("limits every deletion statement to 500 rows and continues when images fill a batch", async () => {
    await pool.query(
      `INSERT INTO messaging_contacts (instagram_scoped_id, created_at, last_inbound_at)
       SELECT (99000000000 + n)::text, now() - interval '91 days', now() - interval '91 days'
         FROM generate_series(1, 501) n`,
    );
    await pool.query(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body, received_at)
       SELECT id, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED', 'Payment proof',
              now() - interval '91 days'
         FROM messaging_contacts WHERE instagram_scoped_id::bigint BETWEEN 99000000001 AND 99000000501`,
    );
    await pool.query(
      `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
       SELECT m.id, n, 'image/png', 1, $1
         FROM messages m JOIN messaging_contacts c ON c.id = m.contact_id
         CROSS JOIN generate_series(0, 9) n
        WHERE c.instagram_scoped_id::bigint BETWEEN 99000000001 AND 99000000501`,
      [Buffer.from([1])],
    );
    await pool.query(
      `CREATE TABLE retention_test_batches (table_name text, affected integer CHECK (affected <= 500));
       CREATE FUNCTION retention_test_capture_batch() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         INSERT INTO retention_test_batches SELECT TG_TABLE_NAME, count(*) FROM deleted_rows;
         RETURN NULL;
       END; $$;
       CREATE TRIGGER retention_test_attachment_batch AFTER DELETE ON message_attachments
       REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION retention_test_capture_batch();
       CREATE TRIGGER retention_test_message_batch AFTER DELETE ON messages
       REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION retention_test_capture_batch();
       CREATE TRIGGER retention_test_contact_batch AFTER DELETE ON messaging_contacts
       REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION retention_test_capture_batch()`,
    );
    try {
      const first = await repository.purgeUnattributedMessagesBatch();
      expect(first.hasMore).toBe(true);
      expect(first.deleted).toBeLessThanOrEqual(50);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM retention_test_batches WHERE table_name = 'message_attachments' AND affected = 500",
          )
        ).rows[0]!.count,
      ).toBe(1);
      const remaining = await purgeExpiredUnattributedPersonalData(
        { repository },
        { timeBudgetMs: 40_000 },
      );
      expect(remaining).toEqual({ messages: 501 - first.deleted, contacts: 501 });
      const batches = await pool.query<{ table_name: string; affected: number }>(
        "SELECT * FROM retention_test_batches",
      );
      expect(batches.rows.every((row) => row.affected <= 500)).toBe(true);
      expect(
        batches.rows
          .filter((row) => row.table_name === "message_attachments")
          .reduce((sum, row) => sum + row.affected, 0),
      ).toBe(5010);
      expect(
        batches.rows
          .filter((row) => row.table_name === "messages")
          .reduce((sum, row) => sum + row.affected, 0),
      ).toBe(501);
      expect(
        batches.rows
          .filter((row) => row.table_name === "messaging_contacts")
          .map((row) => row.affected),
      ).toContain(500);
    } finally {
      await pool.query(
        `DROP TRIGGER retention_test_attachment_batch ON message_attachments;
         DROP TRIGGER retention_test_message_batch ON messages;
         DROP TRIGGER retention_test_contact_batch ON messaging_contacts;
         DROP FUNCTION retention_test_capture_batch();
         DROP TABLE retention_test_batches`,
      );
    }
  });

  it("stops scheduling batches at 40 seconds and returns the committed counts", async () => {
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValue(40_000);
    const messages = vi.fn().mockResolvedValueOnce({ deleted: 500, hasMore: false });
    const contacts = vi.fn().mockResolvedValueOnce({ deleted: 500, hasMore: true });
    await expect(
      purgeExpiredUnattributedPersonalData(
        {
          repository: {
            purgeUnattributedMessagesBatch: messages,
            purgeOrphanedContactsBatch: contacts,
          },
          now,
        },
        { timeBudgetMs: 100_000 },
      ),
    ).resolves.toEqual({ messages: 500, contacts: 500 });
    expect(messages).toHaveBeenCalledOnce();
    expect(contacts).toHaveBeenCalledOnce();
  });

  it("does not start contact cleanup when message cleanup exhausts the budget", async () => {
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(40_000);
    const messages = vi.fn().mockResolvedValue({ deleted: 0, hasMore: true });
    const contacts = vi.fn();
    await expect(
      purgeExpiredUnattributedPersonalData(
        {
          repository: {
            purgeUnattributedMessagesBatch: messages,
            purgeOrphanedContactsBatch: contacts,
          },
          now,
        },
        { timeBudgetMs: 40_000 },
      ),
    ).resolves.toEqual({ messages: 0, contacts: 0 });
    expect(messages).toHaveBeenCalledOnce();
    expect(contacts).not.toHaveBeenCalled();
  });
});

function privateFields(label: string): GuestFields {
  return {
    partySize: 2,
    guest1Name: `Nombre privado ${label}`,
    guest1Instagram: `private.${label}`,
    guest2Name: `Acompañante privado ${label}`,
    guest2Instagram: `private.${label}.two`,
    hasAllergies: true,
    allergies: `Alergias privadas ${label}`,
    notes: `Notas privadas ${label}`,
  };
}

async function assertGuestAuditsContainNoPersonalData(since: string): Promise<void> {
  const result = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM audit_logs WHERE id > $1
       AND entity_type IN ('RESERVATION', 'WAITLIST_ENTRY', 'MESSAGING_CONTACT')`,
    [since],
  );
  expect(result.rows.length).toBeGreaterThan(0);
  const allowed = new Set([
    "eventId",
    "reservationNumber",
    "waitlistNumber",
    "waitlistEntryId",
    "partySize",
    "stage",
    "promotedCount",
    "refundPending",
    "changedFields",
    "direction",
    "from",
    "to",
    "contactId",
    "previousContactId",
    "method",
    "reason",
  ]);
  for (const row of result.rows) {
    expect(Object.keys(row.metadata).every((key) => allowed.has(key))).toBe(true);
    expect(JSON.stringify(row.metadata)).not.toMatch(
      /privad|private\.|PRIVATE_BODY|PRIVATE_PAYMENT/,
    );
  }
}

describe("guest audit privacy", () => {
  it("keeps creation, edits, payment, cancellation, rejection, refunds and queue operations free of guest PII", async () => {
    const since = (await pool.query("SELECT COALESCE(max(id), 0)::text AS id FROM audit_logs"))
      .rows[0]!.id;
    const adminId = await insertAdminUser(pool);
    const event = await insertTestEvent(pool, { capacity: 2, waitlistCapacity: 5 });
    const guests = new PostgresGuestAdminRepository(pool);
    async function add(label: string): Promise<string> {
      const key = randomUUID();
      const result = await guests.addRequest({
        eventId: event.id,
        actorAdminId: adminId,
        fields: privateFields(label),
        idempotencyKey: key,
      });
      expect(result.ok).toBe(true);
      const row = await pool.query(
        `SELECT id FROM reservations WHERE idempotency_key = $1
         UNION ALL SELECT id FROM waitlist_entries WHERE idempotency_key = $1`,
        [key],
      );
      return row.rows[0]!.id;
    }
    const reservationId = await add("first");
    const firstEntry = await add("waiting");
    const secondEntry = await add("second");
    expect(
      (
        await guests.update({
          reservationId,
          actorAdminId: adminId,
          fields: privateFields("edited"),
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await guests.updateEntry({
          entryId: firstEntry,
          actorAdminId: adminId,
          fields: privateFields("updated"),
        })
      ).ok,
    ).toBe(true);
    expect(
      (await guests.moveEntry({ entryId: secondEntry, actorAdminId: adminId, direction: "UP" })).ok,
    ).toBe(true);
    expect((await guests.accept({ reservationId, actorAdminId: adminId })).ok).toBe(true);
    expect(
      (
        await guests.verifyPayment({
          reservationId,
          actorAdminId: adminId,
          paymentNote: "PRIVATE_PAYMENT",
        })
      ).ok,
    ).toBe(true);
    const cancelled = await guests.cancel({
      reservationId,
      actorAdminId: adminId,
      expectedStage: "PAID",
      sendMessage: true,
      expectedPromotedEntryIds: [secondEntry],
    });
    expect(cancelled.ok).toBe(true);
    expect(
      (await guests.markRefunded({ reservationId, actorAdminId: adminId, sendMessage: true })).ok,
    ).toBe(true);
    const promoted = await pool.query<{ promoted_reservation_id: string }>(
      "SELECT promoted_reservation_id FROM waitlist_entries WHERE id = $1",
      [secondEntry],
    );
    expect(
      (
        await guests.reject({
          reservationId: promoted.rows[0]!.promoted_reservation_id,
          actorAdminId: adminId,
          sendMessage: true,
          expectedPromotedEntryIds: [firstEntry],
        })
      ).ok,
    ).toBe(true);
    const removedEntry = await add("removed");
    expect(
      (
        await guests.removeEntry({
          entryId: removedEntry,
          actorAdminId: adminId,
          sendMessage: true,
        })
      ).ok,
    ).toBe(true);
    const manualEntry = await add("manual");
    await pool.query("UPDATE events SET capacity = 4 WHERE id = $1", [event.id]);
    expect((await guests.promoteEntry({ entryId: manualEntry, actorAdminId: adminId })).ok).toBe(
      true,
    );
    await assertGuestAuditsContainNoPersonalData(since);
  });

  it("keeps public allocation and contact linking by username, code and admin free of PII", async () => {
    const since = (await pool.query("SELECT COALESCE(max(id), 0)::text AS id FROM audit_logs"))
      .rows[0]!.id;
    const event = await insertTestEvent(pool, { capacity: 2, waitlistCapacity: 5 });
    const allocation = new PostgresReservationAllocationRepository(pool);
    const messages = new PostgresMessageRepository(pool);
    const adminId = await insertAdminUser(pool);
    async function allocate(label: string): Promise<string> {
      const key = randomUUID();
      const fields = privateFields(label);
      const result = await allocation.allocate({
        idempotencyKey: key,
        fingerprint: `private.${label}`,
        eventSlug: event.slug,
        fullName: fields.guest1Name,
        instagramHandle: fields.guest1Instagram,
        guest2FullName: fields.guest2Name,
        guest2InstagramHandle: fields.guest2Instagram,
        partySize: 2,
        notes: fields.notes!,
        allergies: fields.allergies,
        linkCode: generateLinkCode(),
        mapOutcome: mapReservationOutcome,
      });
      expect(result.status).toBe(label === "public" ? 201 : 202);
      return key;
    }
    const key = await allocate("public");
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE idempotency_key = $1",
      [key],
    );
    const reservationId = reservation.rows[0]!.id;
    const waitingKey = await allocate("publicqueue");
    const waiting = await pool.query<{ id: string; link_code: string }>(
      "SELECT id, link_code FROM waitlist_entries WHERE idempotency_key = $1",
      [waitingKey],
    );
    const entry = waiting.rows[0]!;
    const contactId = await contact();
    expect(await messages.linkByUsername(contactId, "private.public")).toBe(true);
    expect(await messages.unlinkContact(contactId, { reservationId }, adminId)).toBe("UPDATED");
    expect(await messages.linkContactByCode(contactId, entry.link_code, adminId)).toBe(1);
    expect(await messages.linkContact(contactId, { reservationId }, adminId)).toBe(true);
    await messages.storeProfile(contactId, "private.profile", "Nombre privado del perfil");
    expect(
      await allocation.cancelWaitlistEntry({ waitlistEntryId: entry.id, actorAdminId: adminId }),
    ).toBe("CANCELLED");
    expect(await allocation.cancelReservation({ reservationId, actorAdminId: adminId })).toBe(
      "CANCELLED",
    );
    await assertGuestAuditsContainNoPersonalData(since);
  });
});
