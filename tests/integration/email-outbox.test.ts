import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deliverPendingEmails } from "@/application/notifications/deliver-pending-emails";
import type { EmailOutboxKind } from "@/application/notifications/email-outbox";
import type { AdminRole } from "@/application/auth/types";
import { PostgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { insertAdminEmailOutbox } from "@/infrastructure/db/insert-email-outbox";
import { PostgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import { inTransaction } from "@/infrastructure/db/transaction";
import { PostgresOutboxEmailComposer } from "@/infrastructure/email/outbox/outbox-email-composer";
import { PostgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";
import { adminAccountNoticeEmail } from "@/infrastructure/email/templates/admin-account-notice-email";
import { adminAddedEmail } from "@/infrastructure/email/templates/admin-added-email";
import { adminSignInAlertEmail } from "@/infrastructure/email/templates/admin-sign-in-alert-email";
import { reservationCancelledEmail } from "@/infrastructure/email/templates/reservation-cancelled-email";
import { reservationConfirmationEmail } from "@/infrastructure/email/templates/reservation-confirmation-email";
import { reservationWaitlistedEmail } from "@/infrastructure/email/templates/reservation-waitlisted-email";
import { waitlistPromotedEmail } from "@/infrastructure/email/templates/waitlist-promoted-email";

import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const LOGIN_URL = "http://localhost:3000/admin/login";

let pool: Pool;
let outbox: PostgresEmailOutboxRepository;
let composer: PostgresOutboxEmailComposer;
let users: PostgresAdminUserRepository;
let auth: PostgresAdminAuthRepository;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  outbox = new PostgresEmailOutboxRepository(pool);
  composer = new PostgresOutboxEmailComposer(pool);
  users = new PostgresAdminUserRepository(pool);
  auth = new PostgresAdminAuthRepository(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE email_outbox");
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(role: AdminRole = "SUPER_ADMIN", displayName = "Admin de prueba") {
  const email = `${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ($1, $1, 'hash', $2, $3)
     RETURNING id`,
    [email, displayName, role],
  );
  return { id: result.rows[0]!.id, email, displayName };
}

async function enqueueAdminRow(adminUserId: string, kind: EmailOutboxKind = "ADMIN_SIGNED_IN") {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO email_outbox (kind, admin_user_id, payload) VALUES ($1, $2, $3) RETURNING id",
    [kind, adminUserId, JSON.stringify({ occurredAt: new Date().toISOString() })],
  );
  return result.rows[0]!.id;
}

async function outboxFor(adminUserId: string) {
  const result = await pool.query<{ kind: string; payload: Record<string, unknown> }>(
    "SELECT kind, payload FROM email_outbox WHERE admin_user_id = $1 ORDER BY created_at, id",
    [adminUserId],
  );
  return result.rows;
}

async function rowById(id: string) {
  const result = await pool.query(
    "SELECT status, attempts, last_error, locked_until, sent_at FROM email_outbox WHERE id = $1",
    [id],
  );
  return result.rows[0];
}

describe("email outbox repository", () => {
  it("never hands the same row to two concurrent drains", async () => {
    const admin = await insertAdmin();
    for (let index = 0; index < 20; index += 1) {
      await enqueueAdminRow(admin.id);
    }

    const [first, second] = await Promise.all([outbox.claimDue(15), outbox.claimDue(15)]);

    const firstIds = first.map((row) => row.id);
    const secondIds = second.map((row) => row.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(20);
    expect([...first, ...second].every((row) => row.attempts === 1)).toBe(true);
  });

  it("does not claim leased, future or finished rows", async () => {
    const admin = await insertAdmin();
    const leased = await enqueueAdminRow(admin.id);
    const future = await enqueueAdminRow(admin.id);
    const sent = await enqueueAdminRow(admin.id);
    const due = await enqueueAdminRow(admin.id);
    await pool.query(
      "UPDATE email_outbox SET locked_until = clock_timestamp() + interval '1 minute' WHERE id = $1",
      [leased],
    );
    await pool.query(
      "UPDATE email_outbox SET next_attempt_at = clock_timestamp() + interval '1 hour' WHERE id = $1",
      [future],
    );
    await pool.query(
      "UPDATE email_outbox SET status = 'SENT', sent_at = clock_timestamp() WHERE id = $1",
      [sent],
    );

    const claimed = await outbox.claimDue(10);

    expect(claimed.map((row) => row.id)).toEqual([due]);
  });

  it("reclaims a row whose lease expired", async () => {
    const admin = await insertAdmin();
    const id = await enqueueAdminRow(admin.id);

    expect(await outbox.claimDue(10)).toHaveLength(1);
    expect(await outbox.claimDue(10)).toHaveLength(0);

    await pool.query(
      "UPDATE email_outbox SET locked_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [id],
    );
    const reclaimed = await outbox.claimDue(10);

    expect(reclaimed.map((row) => row.id)).toEqual([id]);
    expect(reclaimed[0]!.attempts).toBe(2);
  });

  it("marks sent, schedules retries and marks failures", async () => {
    const admin = await insertAdmin();
    const sentId = await enqueueAdminRow(admin.id);
    const retryId = await enqueueAdminRow(admin.id);
    const failedId = await enqueueAdminRow(admin.id);
    await outbox.claimDue(10);

    await outbox.markSent(sentId);
    await outbox.scheduleRetry(retryId, 120, "HTTP_503");
    await outbox.markFailed(failedId, "HTTP_400");

    expect(await rowById(sentId)).toMatchObject({ status: "SENT", locked_until: null });
    expect((await rowById(sentId)).sent_at).toBeInstanceOf(Date);
    expect(await rowById(retryId)).toMatchObject({
      status: "PENDING",
      last_error: "HTTP_503",
      locked_until: null,
    });
    expect(await rowById(failedId)).toMatchObject({ status: "FAILED", last_error: "HTTP_400" });
    const retryRow = await pool.query<{ seconds: number }>(
      `SELECT extract(epoch FROM next_attempt_at - clock_timestamp())::float AS seconds
         FROM email_outbox WHERE id = $1`,
      [retryId],
    );
    expect(retryRow.rows[0]!.seconds).toBeGreaterThan(100);
    expect(retryRow.rows[0]!.seconds).toBeLessThanOrEqual(120);
    expect(await outbox.claimDue(10)).toHaveLength(0);
  });

  it("resets a failed row on retry and ignores other statuses", async () => {
    const admin = await insertAdmin();
    const failedId = await enqueueAdminRow(admin.id);
    const pendingId = await enqueueAdminRow(admin.id);
    await outbox.claimDue(10);
    await outbox.markFailed(failedId, "HTTP_400");

    await expect(outbox.retry(failedId)).resolves.toBe(true);
    await expect(outbox.retry(pendingId)).resolves.toBe(false);
    await expect(outbox.retry(randomUUID())).resolves.toBe(false);

    expect(await rowById(failedId)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect((await outbox.claimDue(10)).map((row) => row.id)).toContain(failedId);
  });

  it("deletes only sent rows older than the retention window", async () => {
    const admin = await insertAdmin();
    const oldSent = await enqueueAdminRow(admin.id);
    const recentSent = await enqueueAdminRow(admin.id);
    const oldPending = await enqueueAdminRow(admin.id);
    await pool.query(
      "UPDATE email_outbox SET status = 'SENT', sent_at = clock_timestamp() - interval '100 days' WHERE id = $1",
      [oldSent],
    );
    await pool.query(
      "UPDATE email_outbox SET status = 'SENT', sent_at = clock_timestamp() - interval '10 days' WHERE id = $1",
      [recentSent],
    );
    await pool.query(
      "UPDATE email_outbox SET created_at = clock_timestamp() - interval '200 days' WHERE id = $1",
      [oldPending],
    );

    await expect(outbox.deleteSentOlderThan(90)).resolves.toBe(1);

    expect(await rowById(oldSent)).toBeUndefined();
    expect(await rowById(recentSent)).toBeDefined();
    expect(await rowById(oldPending)).toBeDefined();
  });

  it("lists recent rows with the recipient resolved and honors filters", async () => {
    const admin = await insertAdmin();
    const failedId = await enqueueAdminRow(admin.id, "ADMIN_DEACTIVATED");
    await enqueueAdminRow(admin.id, "ADMIN_SIGNED_IN");
    await outbox.markFailed(failedId, "HTTP_400");

    const all = await outbox.listRecent({ limit: 10 });
    const failed = await outbox.listRecent({ limit: 10, status: "FAILED" });
    const byKind = await outbox.listRecent({ limit: 10, kind: "ADMIN_SIGNED_IN" });

    expect(all).toHaveLength(2);
    expect(all.every((item) => item.recipientEmail === admin.email)).toBe(true);
    expect(failed).toEqual([
      expect.objectContaining({
        id: failedId,
        kind: "ADMIN_DEACTIVATED",
        status: "FAILED",
        lastError: "HTTP_400",
        attempts: 0,
      }),
    ]);
    expect(byKind.map((item) => item.kind)).toEqual(["ADMIN_SIGNED_IN"]);
    expect(await outbox.listRecent({ limit: 1 })).toHaveLength(1);
  });
});

describe("outbox email composer", () => {
  async function insertReservation(
    eventId: string,
    options: { number: number | null; status?: string } = { number: 7 },
  ) {
    const status = options.status ?? "CONFIRMED";
    const result = await pool.query<{ id: string }>(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, accepted_at, cancelled_at
       ) VALUES (
         $1, $2, $3, 'Ana Perez', 'anaperez', $4, 'ana@example.com', 'ana@example.com', 3,
         now(), $5, now(), $6, $7
       ) RETURNING id`,
      [
        eventId,
        options.number,
        status,
        `+503${Math.floor(Math.random() * 1e7)}`,
        randomUUID(),
        status === "CONFIRMED" ? new Date() : null,
        status === "CANCELLED" ? new Date() : null,
      ],
    );
    return result.rows[0]!.id;
  }

  async function insertWaitlistEntry(eventId: string, promotedReservationId: string | null = null) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, promoted_reservation_id, promoted_at
       ) VALUES (
         $1, 2, $2, 'Beto Gomez', 'betogomez', '+50370001111', 'beto@example.com',
         'beto@example.com', 2, now(), $3, now(), $4, $5
       ) RETURNING id`,
      [
        eventId,
        promotedReservationId ? "PROMOTED" : "WAITING",
        randomUUID(),
        promotedReservationId,
        promotedReservationId ? new Date() : null,
      ],
    );
    return result.rows[0]!.id;
  }

  async function claimedRow(insert: string, values: unknown[]) {
    await pool.query(`INSERT INTO email_outbox ${insert}`, values);
    const [row] = await outbox.claimDue(1);
    return row!;
  }

  async function startsAt(eventId: string): Promise<Date> {
    const result = await pool.query<{ starts_at: Date }>(
      "SELECT starts_at FROM events WHERE id = $1",
      [eventId],
    );
    return result.rows[0]!.starts_at;
  }

  it("renders a reservation confirmation from reservation and event data", async () => {
    const event = await insertTestEvent(pool);
    const reservationId = await insertReservation(event.id);
    const row = await claimedRow("(kind, reservation_id) VALUES ($1, $2)", [
      "RESERVATION_CONFIRMED",
      reservationId,
    ]);

    await expect(composer.compose(row)).resolves.toEqual({
      to: { email: "ana@example.com", name: "Ana Perez" },
      rendered: reservationConfirmationEmail({
        fullName: "Ana Perez",
        reservationNumber: 7,
        partySize: 3,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders a reservation cancellation with its number", async () => {
    const event = await insertTestEvent(pool);
    const reservationId = await insertReservation(event.id, { number: 4, status: "CANCELLED" });
    const row = await claimedRow("(kind, reservation_id) VALUES ($1, $2)", [
      "RESERVATION_CANCELLED",
      reservationId,
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      rendered: reservationCancelledEmail({
        fullName: "Ana Perez",
        reservationNumber: 4,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders a waitlisted email using the payload position", async () => {
    const event = await insertTestEvent(pool);
    const entryId = await insertWaitlistEntry(event.id);
    const row = await claimedRow("(kind, waitlist_entry_id, payload) VALUES ($1, $2, $3)", [
      "RESERVATION_WAITLISTED",
      entryId,
      JSON.stringify({ position: 2 }),
    ]);

    await expect(composer.compose(row)).resolves.toEqual({
      to: { email: "beto@example.com", name: "Beto Gomez" },
      rendered: reservationWaitlistedEmail({
        fullName: "Beto Gomez",
        position: 2,
        partySize: 2,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders a promotion for a waitlist entry using the promoted reservation number", async () => {
    const event = await insertTestEvent(pool);
    const reservationId = await insertReservation(event.id, { number: 9 });
    const entryId = await insertWaitlistEntry(event.id, reservationId);
    const row = await claimedRow("(kind, waitlist_entry_id) VALUES ($1, $2)", [
      "WAITLIST_PROMOTED",
      entryId,
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      to: { email: "beto@example.com", name: "Beto Gomez" },
      rendered: waitlistPromotedEmail({
        fullName: "Beto Gomez",
        reservationNumber: 9,
        partySize: 2,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders a promotion for a reservation subject", async () => {
    const event = await insertTestEvent(pool);
    const reservationId = await insertReservation(event.id, { number: 11 });
    const row = await claimedRow("(kind, reservation_id) VALUES ($1, $2)", [
      "WAITLIST_PROMOTED",
      reservationId,
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      rendered: waitlistPromotedEmail({
        fullName: "Ana Perez",
        reservationNumber: 11,
        partySize: 3,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders a waitlist cancellation without a number", async () => {
    const event = await insertTestEvent(pool);
    const entryId = await insertWaitlistEntry(event.id);
    const row = await claimedRow("(kind, waitlist_entry_id) VALUES ($1, $2)", [
      "WAITLIST_CANCELLED",
      entryId,
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      rendered: reservationCancelledEmail({
        fullName: "Beto Gomez",
        reservationNumber: null,
        eventStartsAt: await startsAt(event.id),
      }),
    });
  });

  it("renders admin added and sign-in alert emails from payload data", async () => {
    const admin = await insertAdmin("ADMIN", "Nueva Persona");
    const added = await claimedRow("(kind, admin_user_id, payload) VALUES ($1, $2, $3)", [
      "ADMIN_ADDED",
      admin.id,
      JSON.stringify({ addedByDisplayName: "Jefa" }),
    ]);
    const occurredAt = new Date("2026-10-01T15:30:00.000Z");
    const signedIn = await claimedRow("(kind, admin_user_id, payload) VALUES ($1, $2, $3)", [
      "ADMIN_SIGNED_IN",
      admin.id,
      JSON.stringify({ ipAddress: "203.0.113.9", occurredAt: occurredAt.toISOString() }),
    ]);

    await expect(composer.compose(added)).resolves.toEqual({
      to: { email: admin.email, name: "Nueva Persona" },
      rendered: adminAddedEmail({
        displayName: "Nueva Persona",
        role: "ADMIN",
        addedByDisplayName: "Jefa",
        loginUrl: LOGIN_URL,
      }),
    });
    await expect(composer.compose(signedIn)).resolves.toMatchObject({
      rendered: adminSignInAlertEmail({
        displayName: "Nueva Persona",
        occurredAt,
        ipAddress: "203.0.113.9",
      }),
    });
  });

  it.each([
    ["ADMIN_PASSWORD_RESET_BY_ADMIN", "PASSWORD_RESET_BY_ADMIN"],
    ["ADMIN_PASSWORD_CHANGED", "PASSWORD_CHANGED"],
    ["ADMIN_PASSWORD_RESET_COMPLETED", "PASSWORD_RESET_COMPLETED"],
    ["ADMIN_DEACTIVATED", "DEACTIVATED"],
    ["ADMIN_REACTIVATED", "REACTIVATED"],
    ["ADMIN_DELETED", "DELETED"],
    ["ADMIN_SESSIONS_REVOKED", "SESSIONS_REVOKED"],
  ] as const)("renders %s as the %s notice", async (kind, notice) => {
    const admin = await insertAdmin("ADMIN", "Persona Aviso");
    const row = await claimedRow("(kind, admin_user_id) VALUES ($1, $2)", [kind, admin.id]);

    await expect(composer.compose(row)).resolves.toEqual({
      to: { email: admin.email, name: "Persona Aviso" },
      rendered: adminAccountNoticeEmail({
        displayName: "Persona Aviso",
        notice,
        loginUrl: LOGIN_URL,
      }),
    });
  });

  it("renders a role change using the payload role", async () => {
    const admin = await insertAdmin("ADMIN", "Persona Rol");
    const row = await claimedRow("(kind, admin_user_id, payload) VALUES ($1, $2, $3)", [
      "ADMIN_ROLE_CHANGED",
      admin.id,
      JSON.stringify({ role: "SUPER_ADMIN" }),
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      rendered: adminAccountNoticeEmail({
        displayName: "Persona Rol",
        notice: "ROLE_CHANGED",
        role: "SUPER_ADMIN",
        loginUrl: LOGIN_URL,
      }),
    });
  });

  it("still addresses the deletion notice to a soft-deleted admin", async () => {
    const admin = await insertAdmin("ADMIN", "Persona Eliminada");
    await pool.query("UPDATE admin_users SET deleted_at = now(), is_active = false WHERE id = $1", [
      admin.id,
    ]);
    const row = await claimedRow("(kind, admin_user_id) VALUES ($1, $2)", [
      "ADMIN_DELETED",
      admin.id,
    ]);

    await expect(composer.compose(row)).resolves.toMatchObject({
      to: { email: admin.email, name: "Persona Eliminada" },
    });
  });

  it("rejects a payload that lacks a required field instead of sending a partial email", async () => {
    const admin = await insertAdmin();
    const row = await claimedRow("(kind, admin_user_id) VALUES ($1, $2)", [
      "ADMIN_ADDED",
      admin.id,
    ]);

    await expect(composer.compose(row)).rejects.toThrow("addedByDisplayName");
  });

  it("delivers composed rows end to end with a fake sender", async () => {
    const admin = await insertAdmin();
    const id = await enqueueAdminRow(admin.id);
    const sent: string[] = [];

    const summary = await deliverPendingEmails(
      {
        repository: outbox,
        composer,
        sender: {
          send: async (email) => {
            sent.push(email.to.email);
          },
        },
        logFailure: () => undefined,
      },
      { limit: 10 },
    );

    expect(summary).toEqual({ delivered: 1, retried: 0, failed: 0 });
    expect(sent).toEqual([admin.email]);
    expect(await rowById(id)).toMatchObject({ status: "SENT" });
  });

  it("fails rows whose subject no longer exists", async () => {
    const admin = await insertAdmin();
    await enqueueAdminRow(admin.id);
    const [row] = await outbox.claimDue(1);

    await expect(composer.compose({ ...row!, adminUserId: randomUUID() })).resolves.toBeNull();
  });
});

describe("admin mutations enqueue exactly one email", () => {
  async function superAdmin() {
    return insertAdmin("SUPER_ADMIN", "Super Persona");
  }

  it("enqueues ADMIN_ADDED with the actor display name on create", async () => {
    const actor = await superAdmin();
    const email = `${randomUUID()}@example.com`;

    const result = await users.create(actor.id, {
      email,
      emailNormalized: email,
      displayName: "Nueva",
      role: "ADMIN",
      passwordHash: "hash",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await outboxFor(result.value.id)).toEqual([
      { kind: "ADMIN_ADDED", payload: { addedByDisplayName: "Super Persona" } },
    ]);
  });

  it("enqueues ADMIN_ROLE_CHANGED only when the role changes", async () => {
    const actor = await superAdmin();
    const target = await insertAdmin("ADMIN", "Objetivo");

    await users.update(actor.id, {
      id: target.id,
      displayName: "Solo nombre",
      role: "ADMIN",
      expectedRole: "ADMIN",
    });
    expect(await outboxFor(target.id)).toEqual([]);

    await users.update(actor.id, {
      id: target.id,
      displayName: "Solo nombre",
      role: "SUPER_ADMIN",
      expectedRole: "ADMIN",
    });
    expect(await outboxFor(target.id)).toEqual([
      { kind: "ADMIN_ROLE_CHANGED", payload: { role: "SUPER_ADMIN" } },
    ]);
  });

  it("enqueues one row for deactivate, reactivate, reset and revoke", async () => {
    const actor = await superAdmin();
    const target = await insertAdmin("ADMIN", "Objetivo");

    await users.revokeSessions(actor.id, target.id);
    await users.resetPassword(actor.id, target.id, "new-hash");
    await users.deactivate(actor.id, target.id);
    await users.reactivate(actor.id, target.id);

    expect((await outboxFor(target.id)).map((row) => row.kind)).toEqual([
      "ADMIN_SESSIONS_REVOKED",
      "ADMIN_PASSWORD_RESET_BY_ADMIN",
      "ADMIN_DEACTIVATED",
      "ADMIN_REACTIVATED",
    ]);
  });

  it("enqueues ADMIN_PASSWORD_CHANGED on an own password change", async () => {
    const admin = await insertAdmin("ADMIN", "Propia");
    const session = (await auth.createSession(admin.id, "hash", null))!;
    const sessionId = (
      await pool.query<{ id: string }>("SELECT id FROM admin_sessions WHERE admin_user_id = $1", [
        admin.id,
      ])
    ).rows[0]!.id;
    expect(session.token).toBeTruthy();

    const result = await users.changeOwnPassword(admin.id, sessionId, "hash", "next-hash");

    expect(result.ok).toBe(true);
    expect((await outboxFor(admin.id)).map((row) => row.kind)).toEqual([
      "ADMIN_SIGNED_IN",
      "ADMIN_PASSWORD_CHANGED",
    ]);
  });

  it("enqueues ADMIN_DELETED when a deletion code is confirmed", async () => {
    const actor = await superAdmin();
    const target = await insertAdmin("ADMIN", "Borrable");
    const codeHash = "ab".repeat(32);

    await users.createDeletionCode(actor.id, target.id, codeHash);
    const result = await users.deleteWithCode(actor.id, target.id, codeHash);

    expect(result.ok).toBe(true);
    expect((await outboxFor(target.id)).map((row) => row.kind)).toEqual(["ADMIN_DELETED"]);
  });

  it("enqueues nothing when a mutation is rejected", async () => {
    const actor = await superAdmin();
    const target = await insertAdmin("ADMIN", "Objetivo");
    const duplicateEmail = (
      await pool.query<{ email: string }>("SELECT email FROM admin_users WHERE id = $1", [
        target.id,
      ])
    ).rows[0]!.email;

    const staleRole = await users.update(actor.id, {
      id: target.id,
      displayName: "X",
      role: "SUPER_ADMIN",
      expectedRole: "SUPER_ADMIN",
    });
    const alreadyActive = await users.reactivate(actor.id, target.id);
    const duplicate = await users.create(actor.id, {
      email: duplicateEmail,
      emailNormalized: duplicateEmail,
      displayName: "Duplicada",
      role: "ADMIN",
      passwordHash: "hash",
    });
    const forbidden = await users.deactivate(target.id, actor.id);
    const wrongPassword = await users.changeOwnPassword(target.id, randomUUID(), "wrong", "next");

    expect(staleRole).toEqual({ ok: false, error: "ROLE_CHANGED" });
    expect(alreadyActive).toEqual({ ok: false, error: "ALREADY_ACTIVE" });
    expect(duplicate).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expect(forbidden).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(wrongPassword).toEqual({ ok: false, error: "INVALID_CURRENT_PASSWORD" });
    const total = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM email_outbox",
    );
    expect(total.rows[0]!.count).toBe(0);
  });

  it("rolls the outbox row back together with a failed transaction", async () => {
    const admin = await insertAdmin();

    await expect(
      inTransaction(pool, [], async (client) => {
        await insertAdminEmailOutbox(client, { kind: "ADMIN_DEACTIVATED", adminUserId: admin.id });
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");

    expect(await outboxFor(admin.id)).toEqual([]);
  });
});

describe("sign-in outbox row", () => {
  it("stores the raw client IP and sign-in time only in the payload", async () => {
    const admin = await insertAdmin("ADMIN", "Entra");

    const session = await auth.createSession(admin.id, "hash", "203.0.113.9");

    expect(session).not.toBeNull();
    const rows = await outboxFor(admin.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("ADMIN_SIGNED_IN");
    expect(rows[0]!.payload.ipAddress).toBe("203.0.113.9");
    expect(new Date(rows[0]!.payload.occurredAt as string).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    const audit = await pool.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1",
      [admin.id],
    );
    expect(JSON.stringify(audit.rows)).not.toContain("203.0.113.9");
  });

  it("stores a null IP when none is known and nothing when sign-in is rejected", async () => {
    const active = await insertAdmin("ADMIN", "Sin IP");
    const rejected = await insertAdmin("ADMIN", "Rechazada");

    await auth.createSession(active.id, "hash", null);
    const rejectedSession = await auth.createSession(rejected.id, "wrong-hash", "203.0.113.9");

    expect((await outboxFor(active.id))[0]!.payload.ipAddress).toBeNull();
    expect(rejectedSession).toBeNull();
    expect(await outboxFor(rejected.id)).toEqual([]);
  });
});
