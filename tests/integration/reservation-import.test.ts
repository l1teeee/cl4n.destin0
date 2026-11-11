import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImportReservations } from "@/application/reservations/import-reservations";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { buildImportRows } from "@/domain/guest-import/import-rows";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { importRowFingerprint, importRowKey } from "@/infrastructure/import/import-keys";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let adminId: string;
let importReservations: ReturnType<typeof createImportReservations>;
let submitReservation: ReturnType<typeof createSubmitReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  const { PostgresReservationAllocationRepository } =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  const repository = new PostgresReservationAllocationRepository(pool);
  importReservations = createImportReservations({
    repository,
    generateLinkCode,
    rowKey: importRowKey,
    rowFingerprint: importRowFingerprint,
  });
  submitReservation = createSubmitReservation({
    repository,
    generateLinkCode,
    computeFingerprint: requestFingerprint,
    botVerifier: allowAllBotVerifier,
    rateLimiter: allowAllRateLimiter,
  });
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name) VALUES ('import@example.com', 'import@example.com', 'hash', 'Admin') RETURNING id`,
  );
  adminId = result.rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
});

function rows(count = 1) {
  return buildImportRows(
    {
      headers: ["Nombre", "Instagram"],
      rows: Array.from({ length: count }, (_, index) => [`Guest ${index}`, `import.${index}`]),
    },
    { guest1Name: 0, guest1Instagram: 1 },
    2,
  );
}

describe("reservation import on PostgreSQL", () => {
  it("imports before public opening, fills seats then cola, records admin source, audits and messages, and replays safely", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 3,
      waitlistCapacity: 1,
      opensOffset: "1 hour",
      closesOffset: "2 hours",
      autoCloseOnFull: true,
    });
    const importId = randomUUID();
    const input = { eventId: event.id, adminId, importId, rows: rows(5) };
    const outcomes = await importReservations(input);
    expect(outcomes.map((row) => row.result)).toEqual([
      "RECEIVED",
      "RECEIVED",
      "RECEIVED",
      "WAITLISTED",
      "EVENT_FULL",
    ]);
    expect(await importReservations(input)).toEqual(outcomes);
    const reservations = await pool.query(
      "SELECT status, source, created_by, terms_accepted_at FROM reservations WHERE event_id = $1 ORDER BY reservation_number NULLS LAST",
      [event.id],
    );
    expect(reservations.rows).toHaveLength(4);
    for (const reservation of reservations.rows)
      expect(reservation).toMatchObject({
        source: "ADMIN",
        created_by: adminId,
        terms_accepted_at: null,
      });
    const waitlist = await pool.query(
      "SELECT source, created_by, terms_accepted_at FROM waitlist_entries WHERE event_id = $1",
      [event.id],
    );
    expect(waitlist.rows).toEqual([
      { source: "ADMIN", created_by: adminId, terms_accepted_at: null },
    ]);
    const audits = await pool.query(
      "SELECT actor_type, actor_admin_id, action, metadata FROM audit_logs WHERE metadata->>'importId' = $1",
      [importId],
    );
    expect(audits.rows).toHaveLength(5);
    expect(audits.rows.filter((audit) => audit.action === "EVENT_CLOSED")).toHaveLength(1);
    for (const audit of audits.rows)
      expect(audit).toMatchObject({
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        metadata: { source: "IMPORT", importId, rowNumber: expect.any(Number) },
      });
    const messages = await pool.query(
      "SELECT kind FROM messages WHERE event_id = $1 ORDER BY created_at, id",
      [event.id],
    );
    expect(messages.rows.map((row) => row.kind)).toEqual([
      "REQUEST_RECEIVED",
      "REQUEST_RECEIVED",
      "REQUEST_RECEIVED",
      "WAITLISTED",
    ]);
    const state = await pool.query(
      "SELECT reserved_seats, waitlisted_count, status FROM events WHERE id = $1",
      [event.id],
    );
    expect(state.rows[0]).toEqual({ reserved_seats: 3, waitlisted_count: 1, status: "CLOSED" });
    const keys = await pool.query("SELECT scope FROM idempotency_records WHERE key = $1", [
      importRowKey(importId, 2),
    ]);
    expect(keys.rows[0]!.scope).toBe("reservation_import");
    const changed = {
      ...input,
      rows: input.rows.map((row) => ({
        ...row,
        guests: row.guests.map((guest) => ({ ...guest, name: "Changed" })),
      })),
    };
    expect((await importReservations(changed)).every((row) => row.result === "CHANGED")).toBe(true);
  });

  it("puts an entire party of two in the cola when only one seat is free", async () => {
    const event = await insertTestEvent(pool, { capacity: 3, waitlistCapacity: 2 });
    await importReservations({ eventId: event.id, adminId, importId: randomUUID(), rows: rows(2) });
    const couple = buildImportRows(
      {
        headers: ["Nombre", "Instagram", "Acompañante", "Instagram 2"],
        rows: [["Eva", "eva", "Luis", "luis"]],
      },
      { guest1Name: 0, guest1Instagram: 1, companions: [{ name: 2, instagram: 3 }] },
      2,
    );
    expect(
      (
        await importReservations({
          eventId: event.id,
          adminId,
          importId: randomUUID(),
          rows: couple,
        })
      )[0],
    ).toMatchObject({ result: "WAITLISTED", waitlistPosition: 1 });
    const state = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id]);
    expect(state.rows[0]!.reserved_seats).toBe(2);
    const entry = await pool.query("SELECT party_size FROM waitlist_entries WHERE event_id = $1", [
      event.id,
    ]);
    expect(entry.rows[0]!.party_size).toBe(2);
  });

  it("imports a group of four as one request with three companion rows", async () => {
    const event = await insertTestEvent(pool, { capacity: 6, maxPartySize: 4 });
    const group = buildImportRows(
      {
        headers: ["Nombre", "Instagram", "N1", "I1", "N2", "I2", "N3", "I3"],
        rows: [["Eva", "grp.eva", "Luis", "grp.luis", "Marta", "grp.marta", "Raul", "grp.raul"]],
      },
      {
        guest1Name: 0,
        guest1Instagram: 1,
        companions: [
          { name: 2, instagram: 3 },
          { name: 4, instagram: 5 },
          { name: 6, instagram: 7 },
        ],
      },
      4,
    );
    expect(group[0]).toMatchObject({ partySize: 4, error: null });
    expect(
      (
        await importReservations({
          eventId: event.id,
          adminId,
          importId: randomUUID(),
          rows: group,
        })
      )[0]!.result,
    ).toBe("RECEIVED");
    const companions = await pool.query(
      `SELECT rg.slot FROM request_guests rg
         JOIN reservations r ON r.id = rg.reservation_id
        WHERE r.event_id = $1 ORDER BY rg.slot`,
      [event.id],
    );
    expect(companions.rows.map((row) => row.slot)).toEqual([2, 3, 4]);
    const state = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id]);
    expect(state.rows[0]!.reserved_seats).toBe(4);
  });

  it("detects a duplicate of an existing public request and leaves the public path unchanged", async () => {
    const event = await insertTestEvent(pool);
    const received = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(event.slug, 1, { guest1Instagram: "import.0" }),
      remoteIp: null,
      rateLimitSubject: "test",
    });
    expect(received.status).toBe(201);
    expect(received.body.status).toBe("RECEIVED");
    expect(
      (
        await importReservations({
          eventId: event.id,
          adminId,
          importId: randomUUID(),
          rows: rows(),
        })
      )[0]!.result,
    ).toBe("DUPLICATE");
    const reservation = await pool.query(
      "SELECT source, created_by, terms_accepted_at FROM reservations WHERE event_id = $1",
      [event.id],
    );
    expect(reservation.rows[0]).toMatchObject({
      source: "PUBLIC",
      created_by: null,
      terms_accepted_at: expect.any(Date),
    });
    const notOpen = await insertTestEvent(pool, { opensOffset: "1 hour", closesOffset: "2 hours" });
    const rejected = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(notOpen.slug, 2),
      remoteIp: null,
      rateLimitSubject: "test",
    });
    expect(rejected.body).toMatchObject({ error: { code: "EVENT_NOT_OPEN" } });
  });

  it("accepts CLOSED events with free seats even after the public window", async () => {
    const event = await insertTestEvent(pool, {
      status: "CLOSED",
      opensOffset: "-2 hours",
      closesOffset: "-1 hour",
    });
    expect(
      (
        await importReservations({
          eventId: event.id,
          adminId,
          importId: randomUUID(),
          rows: rows(),
        })
      )[0]!.result,
    ).toBe("RECEIVED");
  });

  it.each(["DRAFT", "COMPLETED", "CANCELLED", "started", "deleted", "missing"] as const)(
    "rejects %s events without creating requests",
    async (state) => {
      const event = await insertTestEvent(pool, {
        status:
          state === "DRAFT" || state === "COMPLETED" || state === "CANCELLED" ? state : "SCHEDULED",
      });
      if (state === "started")
        await pool.query(
          "UPDATE events SET opens_at = clock_timestamp() - INTERVAL '3 hours', closes_at = clock_timestamp() - INTERVAL '2 hours', starts_at = clock_timestamp() - INTERVAL '1 hour' WHERE id = $1",
          [event.id],
        );
      if (state === "deleted")
        await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
          event.id,
        ]);
      const outcomes = await importReservations({
        eventId: state === "missing" ? randomUUID() : event.id,
        adminId,
        importId: randomUUID(),
        rows: rows(2),
      });
      expect(outcomes.map((row) => row.result)).toEqual(["EVENT_NOT_OPEN", "NOT_PROCESSED"]);
      expect(
        (await pool.query("SELECT id FROM reservations WHERE event_id = $1", [event.id])).rowCount,
      ).toBe(0);
    },
  );

  it("rejects couples on individual-only events", async () => {
    const event = await insertTestEvent(pool, { maxPartySize: 1 });
    const row = {
      ...rows()[0]!,
      partySize: 2,
      guests: [...rows()[0]!.guests, { name: "Companion", instagram: "companion" }],
    };
    expect(
      (
        await importReservations({
          eventId: event.id,
          adminId,
          importId: randomUUID(),
          rows: [row],
        })
      )[0]!.result,
    ).toBe("PARTY_SIZE_NOT_ALLOWED");
  });
});
