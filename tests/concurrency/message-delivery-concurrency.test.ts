import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deliverPendingMessages } from "@/application/messaging/deliver-messages";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { enqueueGuestMessage } from "@/infrastructure/db/repositories/guest-messages";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 10 });
});

afterAll(async () => {
  await pool.end();
});

describe("message delivery concurrency", () => {
  it("two simultaneous drains never send the same row twice", async () => {
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('99990001', clock_timestamp()) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body)
       VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', 'once')`,
      [contact.rows[0]!.id],
    );

    const sendText = vi.fn(async () => ({ messageId: "single-mid" }));
    const messenger: InstagramMessenger = {
      sendText,
      sendImage: vi.fn(),
      fetchProfile: vi.fn(),
      downloadImage: vi.fn(),
    };
    const dependencies = () => ({
      repository: new PostgresMessageRepository(pool),
      messenger,
      now: Date.now,
      logFailure: vi.fn(),
      logStaleLease: vi.fn(),
    });

    await Promise.all([
      deliverPendingMessages(dependencies(), { limit: 1, timeBudgetMs: 5_000 }),
      deliverPendingMessages(dependencies(), { limit: 1, timeBudgetMs: 5_000 }),
    ]);

    expect(sendText).toHaveBeenCalledOnce();
    const row = await pool.query<{
      status: string;
      external_message_id: string;
    }>("SELECT status, external_message_id FROM messages WHERE body = 'once'");
    expect(row.rows).toEqual([{ status: "SENT", external_message_id: "single-mid" }]);
  });

  it("an extended lease prevents a second drain from taking over a slow send", async () => {
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('99990002', clock_timestamp()) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body)
       VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', 'slow')`,
      [contact.rows[0]!.id],
    );

    let releaseSend!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const sendText = vi.fn(async () => {
      notifyStarted();
      await sendStarted;
      return { messageId: "slow-mid" };
    });
    const messenger: InstagramMessenger = {
      sendText,
      sendImage: vi.fn(),
      fetchProfile: vi.fn(),
      downloadImage: vi.fn(),
    };
    const dependencies = () => ({
      repository: new PostgresMessageRepository(pool),
      messenger,
      now: Date.now,
      logFailure: vi.fn(),
      logStaleLease: vi.fn(),
    });

    const firstDrain = deliverPendingMessages(dependencies(), {
      limit: 1,
      timeBudgetMs: 5_000,
    });
    await started;
    await deliverPendingMessages(dependencies(), {
      limit: 1,
      timeBudgetMs: 5_000,
    });
    releaseSend();
    await firstDrain;

    expect(sendText).toHaveBeenCalledOnce();
  });

  it("serializes an uncommitted early echo with the recorder and keeps one SENT row", async () => {
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('99990003', clock_timestamp()) RETURNING id`,
    );
    const queued = await pool.query<{ id: string }>(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body)
       VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', 'race') RETURNING id`,
      [contact.rows[0]!.id],
    );
    const repository = new PostgresMessageRepository(pool);
    const [claimed] = await repository.claimDue(1, [queued.rows[0]!.id]);
    const lease = await repository.extendLease(claimed!.id, claimed!.lockedUntil);
    const mid = `race-${Date.now()}`;

    const echo = await pool.connect();
    try {
      await echo.query("BEGIN");
      await echo.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [mid]);
      await echo.query(
        `INSERT INTO messages (
           contact_id, direction, kind, source, status, body, external_message_id,
           external_part_ids, parts_sent, sent_at
         ) VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'INSTAGRAM_APP', 'SENT', 'race',
                   $2, ARRAY[$2]::text[], 1, clock_timestamp())`,
        [contact.rows[0]!.id, mid],
      );

      let recorderSettled = false;
      const recorder = repository.recordPart(claimed!.id, lease!, mid, true).finally(() => {
        recorderSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(recorderSettled).toBe(false);
      await echo.query("COMMIT");
      await expect(recorder).resolves.toBe(true);
    } catch (error) {
      await echo.query("ROLLBACK");
      throw error;
    } finally {
      echo.release();
    }

    const rows = await pool.query<{
      id: string;
      source: string;
      status: string;
    }>(
      `SELECT id, source, status
         FROM messages
        WHERE contact_id = $1 AND (external_message_id = $2 OR $2 = ANY(external_part_ids))`,
      [contact.rows[0]!.id, mid],
    );
    expect(rows.rows).toEqual([{ id: queued.rows[0]!.id, source: "ADMIN", status: "SENT" }]);
  });

  it("serializes enqueue with linking and retargets the new WAITING_CONTACT row", async () => {
    const event = await pool.query<{ id: string }>(
      `INSERT INTO events (
         slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
       ) VALUES ($1, 'Enqueue race', '2030-11-01', 2, 2, '2030-10-01', '2030-10-02')
       RETURNING id`,
      [`enqueue-${Date.now()}`],
    );
    const reservation = await pool.query<{ id: string }>(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle, party_size,
         terms_accepted_at, idempotency_key, submitted_at, accepted_at
       ) VALUES ($1, 1, 'CONFIRMED', 'Race Guest', 'race.guest', 1,
                 now(), gen_random_uuid(), now(), now()) RETURNING id`,
      [event.rows[0]!.id],
    );
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('99990004', clock_timestamp()) RETURNING id`,
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Race Admin') RETURNING id`,
      [`enqueue-${Date.now()}@example.com`],
    );

    const enqueueClient = await pool.connect();
    await enqueueClient.query("BEGIN");
    try {
      const message = await enqueueGuestMessage(enqueueClient, {
        kind: "REQUEST_RECEIVED",
        subject: { reservationId: reservation.rows[0]!.id },
        eventId: event.rows[0]!.id,
        body: "queued after link",
        source: "SYSTEM",
      });
      let linked = false;
      const link = new PostgresMessageRepository(pool)
        .linkContact(
          contact.rows[0]!.id,
          { reservationId: reservation.rows[0]!.id },
          admin.rows[0]!.id,
        )
        .finally(() => {
          linked = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(linked).toBe(false);
      await enqueueClient.query("COMMIT");
      await expect(link).resolves.toBe(true);
      const final = await pool.query<{ status: string; contact_id: string }>(
        "SELECT status, contact_id FROM messages WHERE id = $1",
        [message.id],
      );
      expect(final.rows).toEqual([{ status: "QUEUED", contact_id: contact.rows[0]!.id }]);
    } catch (error) {
      await enqueueClient.query("ROLLBACK");
      throw error;
    } finally {
      enqueueClient.release();
    }
  });
});
