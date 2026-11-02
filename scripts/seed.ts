import { pathToFileURL } from "node:url";

import { Pool, type PoolClient } from "pg";

import { hashPassword } from "../src/infrastructure/auth/password.ts";

const DEV_ADMIN_EMAIL = "admin@clandestino.local";
const DEV_ADMIN_PASSWORD = "ClandestinoLocal-2026";
const DEMO_EVENT_SLUG = "demo";
const PAST_EVENT_SLUG = "demo-pasada";
const LOCAL_APP_URL = "http://localhost:3000";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

interface DemoGuest {
  fullName: string;
  instagramHandle: string;
}

interface DemoReservation {
  key: string;
  number: number | null;
  status: "CONFIRMED" | "CANCELLED" | "FULL_REJECTED";
  stage: "IN_REVIEW" | "ON_LIST" | "PAID";
  guest: DemoGuest;
  guest2?: DemoGuest;
  allergies?: string;
  linkCode: string | null;
  submittedHoursAgo: number;
  releaseReason?: "REJECTED" | "CANCELLED";
  refundStatus?: "PENDING";
  contactKey?: string;
}

interface DemoWaitlistEntry {
  key: string;
  number: number;
  guest: DemoGuest;
  guest2?: DemoGuest;
  allergies?: string;
  linkCode: string;
  submittedHoursAgo: number;
}

interface DemoContact {
  key: string;
  scopedId: string;
  username: string;
  displayName: string;
  lastInboundMinutesAgo: number;
  read: boolean;
}

interface DemoMessage {
  subjectKey?: string;
  contactKey?: string;
  direction: "OUTBOUND" | "INBOUND";
  kind: string;
  source: "SYSTEM" | "ADMIN" | "GUEST";
  status: string;
  body: string;
  minutesAgo: number;
  lastError?: string;
}

const DEMO_EVENT_PRICE_CENTS = 3500;

const PAYMENT_INSTRUCTIONS =
  "Transferencia de $60 por persona a Banco Agrícola, cuenta 000-000000-0, a nombre de Clandestino.";

const DEMO_RESERVATIONS: readonly DemoReservation[] = [
  {
    key: "andres",
    number: 1,
    status: "CANCELLED",
    stage: "PAID",
    guest: { fullName: "Andrés Portillo", instagramHandle: "demo.andres.portillo" },
    linkCode: "TB7F9G",
    submittedHoursAgo: 52,
    releaseReason: "CANCELLED",
    refundStatus: "PENDING",
  },
  {
    key: "marta",
    number: 2,
    status: "CONFIRMED",
    stage: "PAID",
    guest: { fullName: "Marta Guzmán", instagramHandle: "demo.marta.guzman" },
    guest2: { fullName: "Roberto Campos", instagramHandle: "demo.roberto.campos" },
    linkCode: "WX2H5M",
    submittedHoursAgo: 50,
    contactKey: "marta",
  },
  {
    key: "gabriela",
    number: 3,
    status: "CONFIRMED",
    stage: "PAID",
    guest: { fullName: "Gabriela Flores", instagramHandle: "demo.gabriela.flores" },
    allergies: "Vegetariana",
    linkCode: "ZC6J4P",
    submittedHoursAgo: 48,
  },
  {
    key: "carlos",
    number: 4,
    status: "CONFIRMED",
    stage: "ON_LIST",
    guest: { fullName: "Carlos Mejía", instagramHandle: "demo.carlos.mejia" },
    guest2: { fullName: "Daniela Rivas", instagramHandle: "demo.daniela.rivas" },
    linkCode: "DM3X8R",
    submittedHoursAgo: 30,
    contactKey: "carlos",
  },
  {
    key: "jorge",
    number: 5,
    status: "CONFIRMED",
    stage: "ON_LIST",
    guest: { fullName: "Jorge Alvarado", instagramHandle: "demo.jorge.alvarado" },
    guest2: { fullName: "Paola Cruz", instagramHandle: "demo.paola.cruz" },
    allergies: "Sin gluten (Paola)",
    linkCode: "PR8C2D",
    submittedHoursAgo: 28,
  },
  {
    key: "karla",
    number: 6,
    status: "CANCELLED",
    stage: "IN_REVIEW",
    guest: { fullName: "Karla Menjívar", instagramHandle: "demo.karla.menjivar" },
    linkCode: "SK34ZN",
    submittedHoursAgo: 6,
    releaseReason: "REJECTED",
  },
  {
    key: "ana",
    number: 7,
    status: "CONFIRMED",
    stage: "IN_REVIEW",
    guest: { fullName: "Ana López", instagramHandle: "demo.ana.lopez" },
    guest2: { fullName: "Luis Herrera", instagramHandle: "demo.luis.herrera" },
    allergies: "Alergia al maní (Luis)",
    linkCode: "AN4B7K",
    submittedHoursAgo: 5,
    contactKey: "ana",
  },
  {
    key: "sofia",
    number: 8,
    status: "CONFIRMED",
    stage: "IN_REVIEW",
    guest: { fullName: "Sofía Martínez", instagramHandle: "demo.sofia.martinez" },
    linkCode: "HV92LC",
    submittedHoursAgo: 4,
  },
  {
    key: "ricardo",
    number: null,
    status: "FULL_REJECTED",
    stage: "IN_REVIEW",
    guest: { fullName: "Ricardo Henríquez", instagramHandle: "demo.ricardo.henriquez" },
    linkCode: null,
    submittedHoursAgo: 3.5,
  },
];

const DEMO_WAITLIST: readonly DemoWaitlistEntry[] = [
  {
    key: "fernando",
    number: 1,
    guest: { fullName: "Fernando Ortiz", instagramHandle: "demo.fernando.ortiz" },
    guest2: { fullName: "Lucía Salazar", instagramHandle: "demo.lucia.salazar" },
    linkCode: "FD83RV",
    submittedHoursAgo: 3,
  },
  {
    key: "mauricio",
    number: 2,
    guest: { fullName: "Mauricio Peña", instagramHandle: "demo.mauricio.pena" },
    allergies: "Intolerancia a la lactosa",
    linkCode: "GL5N7Q",
    submittedHoursAgo: 2.5,
  },
  {
    key: "valeria",
    number: 3,
    guest: { fullName: "Valeria Quintanilla", instagramHandle: "demo.valeria.quintanilla" },
    linkCode: "JQ5T6W",
    submittedHoursAgo: 2,
  },
];

const DEMO_CONTACTS: readonly DemoContact[] = [
  {
    key: "ana",
    scopedId: "17841400000000001",
    username: "demo.ana.lopez",
    displayName: "Ana López",
    lastInboundMinutesAgo: 180,
    read: false,
  },
  {
    key: "carlos",
    scopedId: "17841400000000002",
    username: "demo.carlos.mejia",
    displayName: "Carlos Mejía",
    lastInboundMinutesAgo: 60,
    read: false,
  },
  {
    key: "marta",
    scopedId: "17841400000000003",
    username: "demo.marta.guzman",
    displayName: "Marta Guzmán",
    lastInboundMinutesAgo: 2760,
    read: true,
  },
  {
    key: "curioso",
    scopedId: "17841400000000004",
    username: "demo.curioso.sv",
    displayName: "Curioso Demo",
    lastInboundMinutesAgo: 20,
    read: false,
  },
];

const DEMO_MESSAGES: readonly DemoMessage[] = [
  {
    subjectKey: "ana",
    contactKey: "ana",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Hola, acabo de llenar el formulario",
    minutesAgo: 310,
  },
  {
    subjectKey: "ana",
    contactKey: "ana",
    direction: "OUTBOUND",
    kind: "REQUEST_RECEIVED",
    source: "SYSTEM",
    status: "READ",
    body: "¡Felicidades, Ana! Completaste el formulario para la Cena Clandestino Demo. Te confirmaremos por aquí para saber si estás en la lista.",
    minutesAgo: 300,
  },
  {
    subjectKey: "ana",
    contactKey: "ana",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "¿A qué hora es?",
    minutesAgo: 180,
  },
  {
    subjectKey: "ana",
    contactKey: "ana",
    direction: "OUTBOUND",
    kind: "FREE_TEXT",
    source: "ADMIN",
    status: "FAILED",
    body: "La hora exacta te la confirmamos por aquí la víspera.",
    minutesAgo: 120,
    lastError: "META_USER_UNAVAILABLE",
  },
  {
    subjectKey: "sofia",
    direction: "OUTBOUND",
    kind: "REQUEST_RECEIVED",
    source: "SYSTEM",
    status: "WAITING_CONTACT",
    body: "¡Felicidades, Sofía! Completaste el formulario para la Cena Clandestino Demo. Te confirmaremos por aquí para saber si estás en la lista.",
    minutesAgo: 240,
  },
  {
    subjectKey: "carlos",
    contactKey: "carlos",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Hola, ya vi el formulario. ¿Qué sigue?",
    minutesAgo: 1700,
  },
  {
    subjectKey: "carlos",
    contactKey: "carlos",
    direction: "OUTBOUND",
    kind: "ON_LIST",
    source: "SYSTEM",
    status: "SENT",
    body: `¡Felicidades, Carlos, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.\n\n${PAYMENT_INSTRUCTIONS}\n\nCuando transfieras, envíanos el comprobante por aquí.`,
    minutesAgo: 1620,
  },
  {
    subjectKey: "carlos",
    contactKey: "carlos",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Hola, ya transferí",
    minutesAgo: 60,
  },
  {
    subjectKey: "marta",
    contactKey: "marta",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Hola, acabo de llenar el formulario",
    minutesAgo: 2900,
  },
  {
    subjectKey: "marta",
    contactKey: "marta",
    direction: "OUTBOUND",
    kind: "ON_LIST",
    source: "SYSTEM",
    status: "SENT",
    body: `¡Felicidades, Marta, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.\n\n${PAYMENT_INSTRUCTIONS}\n\nCuando transfieras, envíanos el comprobante por aquí.`,
    minutesAgo: 2870,
  },
  {
    subjectKey: "marta",
    contactKey: "marta",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Listo, ya transferí. Gracias",
    minutesAgo: 2760,
  },
  {
    subjectKey: "marta",
    contactKey: "marta",
    direction: "OUTBOUND",
    kind: "PAID",
    source: "ADMIN",
    status: "SENT_MANUALLY",
    body: "¡Felicidades, Marta! Tu lugar está confirmado para la Cena Clandestino Demo. Por aquí te enviaremos las pistas y la ubicación.",
    minutesAgo: 2640,
  },
  {
    subjectKey: "marta",
    contactKey: "marta",
    direction: "OUTBOUND",
    kind: "FREE_TEXT",
    source: "ADMIN",
    status: "WAITING_WINDOW",
    body: "Recuerda llegar 15 minutos antes de la hora indicada.",
    minutesAgo: 600,
  },
  {
    subjectKey: "fernando",
    direction: "OUTBOUND",
    kind: "WAITLISTED",
    source: "SYSTEM",
    status: "WAITING_CONTACT",
    body: "Hola, Fernando. Completaste el formulario, pero el cupo ya se llenó: quedaste en la cola en la posición 1. Si se libera un lugar te escribiremos por aquí.",
    minutesAgo: 180,
  },
  {
    contactKey: "curioso",
    direction: "INBOUND",
    kind: "INBOUND",
    source: "GUEST",
    status: "RECEIVED",
    body: "Hola, ¿cómo puedo anotarme?",
    minutesAgo: 20,
  },
];

const PAST_EVENT_CLUES: readonly string[] = [
  "Busca la puerta verde donde el cartero nunca se detiene.",
  "El aroma a leña te dirá que estás cerca. Pregunta por el Clan.",
];

function redactDatabaseCredentials(message: string): string {
  return message.replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1***@");
}

function operatorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactDatabaseCredentials(message);
}

function hoursBefore(reference: Date, hours: number): Date {
  return new Date(reference.getTime() - hours * HOUR_MS);
}

function hoursAfter(reference: Date, hours: number): Date {
  return new Date(reference.getTime() + hours * HOUR_MS);
}

function minutesBefore(reference: Date, minutes: number): Date {
  return new Date(reference.getTime() - minutes * MINUTE_MS);
}

export function assertLocalDatabaseUrl(databaseUrlValue: string): URL {
  const databaseUrl = new URL(databaseUrlValue);
  if (databaseUrl.hostname !== "127.0.0.1" && databaseUrl.hostname !== "localhost") {
    throw new Error("Seed rechazado: DATABASE_URL debe apuntar a 127.0.0.1 o localhost");
  }
  return databaseUrl;
}

async function ensureDevAdmin(client: PoolClient, log: (message: string) => void): Promise<string> {
  const existingAdmin = await client.query<{ id: string }>(
    "SELECT id FROM admin_users WHERE email_normalized = $1 AND deleted_at IS NULL",
    [DEV_ADMIN_EMAIL],
  );
  const existingId = existingAdmin.rows[0]?.id;
  if (existingId) {
    log("El administrador local ya existe; no se modifico.");
    return existingId;
  }

  const insertedAdmin = await client.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ($1, $1, $2, 'Admin Local', 'SUPER_ADMIN')
     RETURNING id`,
    [DEV_ADMIN_EMAIL, await hashPassword(DEV_ADMIN_PASSWORD)],
  );
  log("Se creo el administrador local.");
  return insertedAdmin.rows[0]!.id;
}

async function eventExists(client: PoolClient, slug: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM events WHERE slug = $1 AND deleted_at IS NULL", [
    slug,
  ]);
  return (result.rowCount ?? 0) > 0;
}

async function recordEventCreated(
  client: PoolClient,
  adminId: string,
  eventId: string,
  status: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type,
       actor_admin_id,
       action,
       entity_type,
       entity_id,
       metadata
     )
     VALUES ('ADMIN', $1, 'EVENT_CREATED', 'EVENT', $2, $3::jsonb)`,
    [adminId, eventId, JSON.stringify({ status })],
  );
}

function guestColumns(guest: DemoGuest, guest2: DemoGuest | undefined): unknown[] {
  return [
    guest.fullName,
    guest.instagramHandle,
    guest2?.fullName ?? null,
    guest2?.instagramHandle ?? null,
    guest2 ? 2 : 1,
  ];
}

async function insertDemoContacts(
  client: PoolClient,
  now: Date,
): Promise<ReadonlyMap<string, string>> {
  const contactIds = new Map<string, string>();
  for (const contact of DEMO_CONTACTS) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messaging_contacts (
         instagram_scoped_id,
         username,
         display_name,
         last_inbound_at,
         admin_read_at
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        contact.scopedId,
        contact.username,
        contact.displayName,
        minutesBefore(now, contact.lastInboundMinutesAgo),
        contact.read ? now : null,
      ],
    );
    contactIds.set(contact.key, inserted.rows[0]!.id);
  }
  return contactIds;
}

async function insertDemoReservation(
  client: PoolClient,
  eventId: string,
  now: Date,
  reservation: DemoReservation,
  contactId: string | null,
): Promise<string> {
  const submittedAt = hoursBefore(now, reservation.submittedHoursAgo);
  const isNumbered = reservation.number !== null;
  const acceptedAt = isNumbered ? new Date(submittedAt.getTime() + MINUTE_MS) : null;
  const onListAt = reservation.stage === "IN_REVIEW" ? null : hoursAfter(submittedAt, 2);
  const paidAt = reservation.stage === "PAID" ? hoursAfter(submittedAt, 5) : null;
  const cancelledHours = reservation.stage === "PAID" ? 8 : 0.5;
  const cancelledAt =
    reservation.status === "CANCELLED" ? hoursAfter(submittedAt, cancelledHours) : null;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id,
       reservation_number,
       status,
       full_name,
       instagram_handle,
       guest2_full_name,
       guest2_instagram_handle,
       party_size,
       allergies,
       terms_accepted_at,
       link_code,
       contact_id,
       contact_linked_by,
       stage,
       on_list_at,
       paid_at,
       release_reason,
       refund_status,
       idempotency_key,
       submitted_at,
       accepted_at,
       cancelled_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       gen_random_uuid(), $10, $19, $20
     )
     RETURNING id`,
    [
      eventId,
      reservation.number,
      reservation.status,
      ...guestColumns(reservation.guest, reservation.guest2),
      reservation.allergies ?? null,
      submittedAt,
      reservation.linkCode,
      contactId,
      contactId ? "CODE" : null,
      reservation.stage,
      onListAt,
      paidAt,
      reservation.releaseReason ?? null,
      reservation.refundStatus ?? null,
      acceptedAt,
      cancelledAt,
    ],
  );
  return inserted.rows[0]!.id;
}

async function insertDemoWaitlistEntry(
  client: PoolClient,
  eventId: string,
  now: Date,
  entry: DemoWaitlistEntry,
): Promise<string> {
  const submittedAt = hoursBefore(now, entry.submittedHoursAgo);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id,
       waitlist_number,
       status,
       full_name,
       instagram_handle,
       guest2_full_name,
       guest2_instagram_handle,
       party_size,
       allergies,
       terms_accepted_at,
       link_code,
       idempotency_key,
       submitted_at
     )
     VALUES ($1, $2, 'WAITING', $3, $4, $5, $6, $7, $8, $9, $10, gen_random_uuid(), $9)
     RETURNING id`,
    [
      eventId,
      entry.number,
      ...guestColumns(entry.guest, entry.guest2),
      entry.allergies ?? null,
      submittedAt,
      entry.linkCode,
    ],
  );
  return inserted.rows[0]!.id;
}

async function insertDemoMessage(
  client: PoolClient,
  adminId: string,
  eventId: string,
  now: Date,
  message: DemoMessage,
  contactIds: ReadonlyMap<string, string>,
  reservationIds: ReadonlyMap<string, string>,
  waitlistIds: ReadonlyMap<string, string>,
): Promise<void> {
  const createdAt = minutesBefore(now, message.minutesAgo);
  const hasBeenSent =
    message.status === "SENT" || message.status === "READ" || message.status === "SENT_MANUALLY";
  const contactId = message.contactKey ? (contactIds.get(message.contactKey) ?? null) : null;
  const reservationId = message.subjectKey
    ? (reservationIds.get(message.subjectKey) ?? null)
    : null;
  const waitlistEntryId = message.subjectKey ? (waitlistIds.get(message.subjectKey) ?? null) : null;

  await client.query(
    `INSERT INTO messages (
       contact_id,
       reservation_id,
       waitlist_entry_id,
       event_id,
       direction,
       kind,
       source,
       status,
       body,
       attempts,
       last_error,
       sent_at,
       read_at,
       created_by,
       handled_by,
       received_at,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
    [
      contactId,
      reservationId,
      waitlistEntryId,
      eventId,
      message.direction,
      message.kind,
      message.source,
      message.status,
      message.body,
      message.status === "FAILED" ? 1 : 0,
      message.lastError ?? null,
      hasBeenSent ? createdAt : null,
      message.status === "READ" ? new Date(createdAt.getTime() + 30 * MINUTE_MS) : null,
      message.source === "ADMIN" ? adminId : null,
      message.status === "SENT_MANUALLY" ? adminId : null,
      createdAt,
    ],
  );
}

// Without payment data and a price per event, no guest can be accepted onto the list.
async function seedPaymentSettings(
  client: PoolClient,
  adminId: string,
  log: (message: string) => void,
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO payment_settings
       (id, bank_name, account_type, account_number, account_holder, updated_by)
     VALUES (1, 'Banco Demo', 'Ahorro', '000-000000-0', 'Clandestino Demo', $1)
     ON CONFLICT (id) DO NOTHING`,
    [adminId],
  );
  log(
    inserted.rowCount === 1
      ? "Se crearon los datos de pago de demostración."
      : "Los datos de pago ya existen; no se modificaron.",
  );
}

async function seedDemoEvent(
  client: PoolClient,
  adminId: string,
  now: Date,
  log: (message: string) => void,
): Promise<void> {
  if (await eventExists(client, DEMO_EVENT_SLUG)) {
    log(`El evento ${DEMO_EVENT_SLUG} ya existe; no se modifico.`);
    return;
  }

  const reservedSeats = DEMO_RESERVATIONS.filter(
    (reservation) => reservation.status === "CONFIRMED",
  ).reduce((total, reservation) => total + (reservation.guest2 ? 2 : 1), 0);
  const lastReservationNumber = Math.max(
    ...DEMO_RESERVATIONS.map((reservation) => reservation.number ?? 0),
  );

  const insertedEvent = await client.query<{ id: string }>(
    `INSERT INTO events (
       internal_name,
       slug,
       starts_at,
       capacity,
       reserved_seats,
       max_party_size,
       opens_at,
       closes_at,
       auto_close_on_full,
       status,
       location_name,
       location_address,
       location_maps_url,
       location_notes,
       location_status,
       location_confirmed_at,
       location_revision,
       price_cents,
       last_reservation_number,
       waitlist_capacity,
       waitlisted_count,
       last_waitlist_number
     )
     VALUES (
       'Cena Clandestino Demo', $1, $2, 10, $3, 2, $4, $5, false, 'SCHEDULED',
       'Casa Clandestina', 'Colonia Escalón, San Salvador (dirección de demostración)',
       'https://maps.google.com/?q=13.6989,-89.2182',
       'Toca el timbre dos veces y menciona tu código.',
       'CONFIRMED', $6, 1, $7, $8, 5, $9, $9
     )
     RETURNING id`,
    [
      DEMO_EVENT_SLUG,
      new Date(now.getTime() + 10 * DAY_MS),
      reservedSeats,
      new Date(now.getTime() - 3 * DAY_MS),
      new Date(now.getTime() + 7 * DAY_MS),
      now,
      DEMO_EVENT_PRICE_CENTS,
      lastReservationNumber,
      DEMO_WAITLIST.length,
    ],
  );
  const eventId = insertedEvent.rows[0]!.id;
  await recordEventCreated(client, adminId, eventId, "SCHEDULED");

  const contactIds = await insertDemoContacts(client, now);
  const reservationIds = new Map<string, string>();
  for (const reservation of DEMO_RESERVATIONS) {
    const contactId = reservation.contactKey
      ? (contactIds.get(reservation.contactKey) ?? null)
      : null;
    reservationIds.set(
      reservation.key,
      await insertDemoReservation(client, eventId, now, reservation, contactId),
    );
  }
  const waitlistIds = new Map<string, string>();
  for (const entry of DEMO_WAITLIST) {
    waitlistIds.set(entry.key, await insertDemoWaitlistEntry(client, eventId, now, entry));
  }
  for (const message of DEMO_MESSAGES) {
    await insertDemoMessage(
      client,
      adminId,
      eventId,
      now,
      message,
      contactIds,
      reservationIds,
      waitlistIds,
    );
  }
  log(`Se creó el evento de demostración ${DEMO_EVENT_SLUG} con solicitudes, cola y mensajes.`);
}

async function seedPastEvent(
  client: PoolClient,
  adminId: string,
  now: Date,
  log: (message: string) => void,
): Promise<void> {
  if (await eventExists(client, PAST_EVENT_SLUG)) {
    log(`El evento ${PAST_EVENT_SLUG} ya existe; no se modifico.`);
    return;
  }

  const insertedEvent = await client.query<{ id: string }>(
    `INSERT INTO events (
       internal_name,
       slug,
       starts_at,
       capacity,
       max_party_size,
       opens_at,
       closes_at,
       auto_close_on_full,
       status,
       price_cents
     )
     VALUES ('Experiencia pasada demo', $1, $2, 10, 2, $3, $4, false, 'COMPLETED', $5)
     RETURNING id`,
    [
      PAST_EVENT_SLUG,
      new Date(now.getTime() - 20 * DAY_MS),
      new Date(now.getTime() - 40 * DAY_MS),
      new Date(now.getTime() - 30 * DAY_MS),
      DEMO_EVENT_PRICE_CENTS,
    ],
  );
  const eventId = insertedEvent.rows[0]!.id;
  await recordEventCreated(client, adminId, eventId, "COMPLETED");

  for (const [index, body] of PAST_EVENT_CLUES.entries()) {
    await client.query(
      "INSERT INTO event_clues (event_id, body, created_by, created_at) VALUES ($1, $2, $3, $4)",
      [eventId, body, adminId, hoursBefore(now, 24 * 20 + 2 - index)],
    );
  }
  log(
    `Se creó el evento de demostración ${PAST_EVENT_SLUG} con ${PAST_EVENT_CLUES.length} pistas.`,
  );
}

function logAccessSummary(log: (message: string) => void): void {
  log("");
  log("Datos de demostración locales:");
  log(`  Admin:            ${LOCAL_APP_URL}/admin`);
  log(`  Mensajes:         ${LOCAL_APP_URL}/admin/mensajes`);
  log(`  Correo admin:     ${DEV_ADMIN_EMAIL}`);
  log(`  Contraseña admin: ${DEV_ADMIN_PASSWORD}`);
  log(`  Formulario:       ${LOCAL_APP_URL}/solicitar/${DEMO_EVENT_SLUG}`);
  log(`  Pistas:           ${LOCAL_APP_URL}/pistas/${PAST_EVENT_SLUG}`);
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
    const adminId = await ensureDevAdmin(client, log);
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = clock.rows[0]!.now;
    await seedPaymentSettings(client, adminId, log);
    await seedDemoEvent(client, adminId, now, log);
    await seedPastEvent(client, adminId, now, log);
    await client.query("COMMIT");
    logAccessSummary(log);
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
    seedDatabase(databaseUrlValue).catch((error: unknown) => {
      console.error("No se pudo ejecutar el seed.");
      console.error(operatorErrorMessage(error));
      process.exitCode = 1;
    });
  }
}
