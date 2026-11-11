import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  enqueueGuestMessage,
  loadGuestMessageValues,
  renderGuestMessage,
} from "@/infrastructure/db/repositories/guest-messages";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import { configurePaymentSettings } from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

interface Fixtures {
  eventId: string;
  startsAt: Date;
  linkedReservationId: string;
  unlinkedReservationId: string;
  linkedWaitlistId: string;
  unlinkedWaitlistId: string;
}

let pool: Pool;
let fixtures: Fixtures;

function expectedPayment(monto: string) {
  return {
    monto,
    banco: "Banco Demo",
    tipo_cuenta: "Ahorro",
    cuenta: "0123456789",
    titular: "Clandestino",
    enlace_pago: "",
    nota_pago: "Paga antes del jueves",
    pago: [
      `Monto: ${monto}`,
      "Banco: Banco Demo",
      "Tipo de cuenta: Ahorro",
      "Cuenta: 0123456789",
      "Titular: Clandestino",
      "Paga antes del jueves",
    ].join("\n"),
  };
}

async function createFixtures(client: PoolClient): Promise<Fixtures> {
  const startsAt = new Date("2030-11-23T01:30:00.000Z");
  const event = await client.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
       payment_instructions, price_cents
     ) VALUES (
       'guest-message-values', 'Guest message values', $1, 20, 2,
       $1::timestamptz - interval '2 days', $1::timestamptz - interval '1 day',
       'Paga antes del jueves', 2500
     ) RETURNING id`,
    [startsAt],
  );
  await configurePaymentSettings(client);
  const eventId = event.rows[0]!.id;
  const contacts = await client.query<{ id: string }>(
    `INSERT INTO messaging_contacts (instagram_scoped_id, username)
     VALUES ('10001', 'ana.lopez'), ('10002', 'maria.soto')
     RETURNING id`,
  );
  const reservations = await client.query<{ id: string; full_name: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       idempotency_key, submitted_at, accepted_at, contact_id, contact_linked_by
     ) VALUES
       ($1, 1, 'CONFIRMED', 'Ana López', 'ana.lopez', 'Luis Pérez', 'luis.perez', 2,
        now(), $2, now(), now(), $4, 'MANUAL'),
       ($1, 2, 'CONFIRMED', 'Carlos Ruiz', 'carlos.ruiz', NULL, NULL, 1,
        now(), $3, now(), now(), NULL, NULL)
     RETURNING id, full_name`,
    [eventId, randomUUID(), randomUUID(), contacts.rows[0]!.id],
  );
  const waitlist = await client.query<{ id: string; full_name: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle, party_size,
       terms_accepted_at, idempotency_key, submitted_at, contact_id, contact_linked_by
     ) VALUES
       ($1, 3, 'WAITING', 'José León', 'jose.leon', 1, now(), $2, now(), $4, 'MANUAL'),
       ($1, 8, 'WAITING', 'María Soto', 'maria.soto', 1, now(), $3, now(), $5, NULL)
     RETURNING id, full_name`,
    [eventId, randomUUID(), randomUUID(), contacts.rows[1]!.id, null],
  );
  await client.query(
    `INSERT INTO request_guests (reservation_id, slot, full_name, instagram_handle)
     SELECT id, 2, guest2_full_name, guest2_instagram_handle FROM reservations
      WHERE event_id = $1 AND guest2_full_name IS NOT NULL`,
    [eventId],
  );

  return {
    eventId,
    startsAt,
    linkedReservationId: reservations.rows.find((row) => row.full_name === "Ana López")!.id,
    unlinkedReservationId: reservations.rows.find((row) => row.full_name === "Carlos Ruiz")!.id,
    linkedWaitlistId: waitlist.rows.find((row) => row.full_name === "José León")!.id,
    unlinkedWaitlistId: waitlist.rows.find((row) => row.full_name === "María Soto")!.id,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  const client = await pool.connect();
  try {
    fixtures = await createFixtures(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("guest message repository", () => {
  it("queues reservation messages only when a contact is linked", async () => {
    const client = await pool.connect();
    try {
      const linked = await enqueueGuestMessage(client, {
        kind: "REQUEST_RECEIVED",
        subject: { reservationId: fixtures.linkedReservationId },
        eventId: fixtures.eventId,
        body: "Mensaje con contacto",
        source: "SYSTEM",
      });
      const unlinked = await enqueueGuestMessage(client, {
        kind: "REQUEST_RECEIVED",
        subject: { reservationId: fixtures.unlinkedReservationId },
        eventId: fixtures.eventId,
        body: "Mensaje sin contacto",
        source: "SYSTEM",
      });

      expect(linked.status).toBe("QUEUED");
      expect(unlinked.status).toBe("WAITING_CONTACT");
    } finally {
      client.release();
    }
  });

  it("queues waitlist messages only when a contact is linked", async () => {
    const client = await pool.connect();
    try {
      const linked = await enqueueGuestMessage(client, {
        kind: "WAITLISTED",
        subject: { waitlistEntryId: fixtures.linkedWaitlistId },
        eventId: fixtures.eventId,
        body: "Cola con contacto",
        source: "SYSTEM",
      });
      const unlinked = await enqueueGuestMessage(client, {
        kind: "WAITLISTED",
        subject: { waitlistEntryId: fixtures.unlinkedWaitlistId },
        eventId: fixtures.eventId,
        body: "Cola sin contacto",
        source: "SYSTEM",
      });

      expect(linked.status).toBe("QUEUED");
      expect(unlinked.status).toBe("WAITING_CONTACT");
    } finally {
      client.release();
    }
  });

  it("loads couple, single and waiting-position values", async () => {
    const client = await pool.connect();
    try {
      await expect(
        loadGuestMessageValues(client, { reservationId: fixtures.linkedReservationId }),
      ).resolves.toEqual({
        nombre: "Ana",
        nombres: "Ana y Luis",
        fecha: formatPublicEventDate(fixtures.startsAt),
        ...expectedPayment("$50.00"),
      });
      await expect(
        loadGuestMessageValues(client, { reservationId: fixtures.unlinkedReservationId }),
      ).resolves.toEqual({
        nombre: "Carlos",
        nombres: "Carlos",
        fecha: formatPublicEventDate(fixtures.startsAt),
        ...expectedPayment("$25.00"),
      });
      await expect(
        loadGuestMessageValues(client, { waitlistEntryId: fixtures.unlinkedWaitlistId }),
      ).resolves.toEqual({
        nombre: "María",
        nombres: "María",
        fecha: formatPublicEventDate(fixtures.startsAt),
        ...expectedPayment("$25.00"),
        posicion: "2",
      });
    } finally {
      client.release();
    }
  });

  it("leaves the bank variables empty and omits their lines while the payment settings are missing", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM payment_settings");
      const values = await loadGuestMessageValues(client, {
        reservationId: fixtures.linkedReservationId,
      });
      await client.query("ROLLBACK");

      expect(values).toMatchObject({
        monto: "$50.00",
        banco: "",
        cuenta: "",
        pago: "Monto: $50.00\nPaga antes del jueves",
      });
    } finally {
      client.release();
    }
  });

  it("renders the seeded ON_LIST template with the composed payment block", async () => {
    const client = await pool.connect();
    try {
      const values = await loadGuestMessageValues(client, {
        reservationId: fixtures.unlinkedReservationId,
      });
      const body = await renderGuestMessage(client, "ON_LIST", values);

      expect(body).toBe(
        [
          "¡Felicidades, Carlos, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.",
          "",
          "Monto: $25.00",
          "Banco: Banco Demo",
          "Tipo de cuenta: Ahorro",
          "Cuenta: 0123456789",
          "Titular: Clandestino",
          "Paga antes del jueves",
          "",
          "Cuando transfieras, envíanos el comprobante por aquí.",
        ].join("\n"),
      );
    } finally {
      client.release();
    }
  });

  it("renders a seeded template", async () => {
    const client = await pool.connect();
    try {
      await expect(renderGuestMessage(client, "REFUNDED", { nombre: "Ana" })).resolves.toBe(
        "Hola, Ana. Ya realizamos la devolución de tu pago. Gracias por tu paciencia; esperamos verte pronto.",
      );
    } finally {
      client.release();
    }
  });
});
