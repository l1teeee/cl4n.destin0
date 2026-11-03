import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { PostgresMessageTemplateRepository } from "@/infrastructure/db/repositories/postgres-message-template-repository";

import {
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  insertMessagingContact,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresMessageRepository;
let templates: PostgresMessageTemplateRepository;
let eventId: string;
let otherEventId: string;
let adminId: string;
let contactId: string;
let linkedReservationId: string;
let unlinkedReservationId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresMessageRepository(pool);
  templates = new PostgresMessageTemplateRepository(pool);
  eventId = await insertLocationEvent(pool);
  otherEventId = await insertLocationEvent(pool);
  adminId = await insertAdminUser(pool);
  contactId = await insertMessagingContact(pool);
  linkedReservationId = await insertGuestReservation(pool, eventId, { contactId });
  unlinkedReservationId = await insertGuestReservation(pool, eventId);
});

afterAll(async () => {
  await pool.end();
});

describe("tab message repository", () => {
  it("loads the default TAB body after resetting the database", async () => {
    await expect(templates.findTemplateBody("TAB")).resolves.toBe(
      [
        "Hola {nombre}, esta es tu cuenta de consumos de la experiencia del {fecha}:",
        "",
        "{consumos}",
        "",
        "Total a pagar: {total}",
        "",
        "{datos_pago}",
        "",
        "Cuando transfieras, envíanos el comprobante por aquí. ¡Gracias!",
      ].join("\n"),
    );
  });

  it.each([true, false])("enqueues an admin tab with linked contact = %s", async (linked) => {
    const reservationId = linked ? linkedReservationId : unlinkedReservationId;
    const text = "Cuenta editada: 2 × Café: $6.50";
    const id = await repository.enqueueTabMessage({ eventId, reservationId, text, adminId });
    expect(id).not.toBeNull();

    const stored = await pool.query("SELECT * FROM messages WHERE id = $1", [id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      id,
      direction: "OUTBOUND",
      kind: "FREE_TEXT",
      source: "ADMIN",
      reservation_id: reservationId,
      waitlist_entry_id: null,
      event_id: eventId,
      created_by: adminId,
      contact_id: linked ? contactId : null,
      status: linked ? "QUEUED" : "WAITING_CONTACT",
      body: text,
    });
  });

  it("rejects a reservation from another event and stores nothing", async () => {
    const before = await pool.query("SELECT id FROM messages ORDER BY id");
    await expect(
      repository.enqueueTabMessage({
        eventId: otherEventId,
        reservationId: linkedReservationId,
        text: "Cuenta del evento equivocado",
        adminId,
      }),
    ).resolves.toBeNull();
    const after = await pool.query("SELECT id FROM messages ORDER BY id");
    expect(after.rows).toEqual(before.rows);
  });
});
