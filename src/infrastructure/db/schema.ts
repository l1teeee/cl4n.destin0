import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const eventStatus = pgEnum("event_status", [
  "DRAFT",
  "SCHEDULED",
  "CLOSED",
  "COMPLETED",
  "CANCELLED",
]);

export const reservationStatus = pgEnum("reservation_status", [
  "SUBMITTED",
  "CONFIRMED",
  "FULL_REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

export const auditAction = pgEnum("audit_action", [
  "EVENT_CREATED",
  "EVENT_UPDATED",
  "EVENT_OPENED",
  "EVENT_CLOSED",
  "CAPACITY_CHANGED",
  "RESERVATION_CREATED",
  "RESERVATION_CANCELLED",
  "ADMIN_SIGNED_IN",
]);

export const actorType = pgEnum("actor_type", ["ADMIN", "PUBLIC", "SYSTEM"]);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").notNull().defaultRandom(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "admin_users_pkey", columns: [table.id] }),
    unique("admin_users_email_normalized_uq").on(table.emailNormalized),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").notNull().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    adminUserId: uuid("admin_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: "admin_sessions_pkey", columns: [table.id] }),
    unique("admin_sessions_token_hash_uq").on(table.tokenHash),
    foreignKey({
      name: "admin_sessions_admin_user_fk",
      columns: [table.adminUserId],
      foreignColumns: [adminUsers.id],
    }).onDelete("cascade"),
    index("admin_sessions_admin_user_idx").on(table.adminUserId),
    index("admin_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").notNull().defaultRandom(),
    slug: text("slug").notNull(),
    internalName: text("internal_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    reservedSeats: integer("reserved_seats").notNull().default(0),
    maxPartySize: integer("max_party_size").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    autoCloseOnFull: boolean("auto_close_on_full").notNull().default(false),
    status: eventStatus("status").notNull().default("DRAFT"),
    lastReservationNumber: integer("last_reservation_number").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "events_pkey", columns: [table.id] }),
    unique("events_slug_uq").on(table.slug),
    check("events_slug_format_chk", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("events_slug_length_chk", sql`char_length(${table.slug}) <= 80`),
    check(
      "events_internal_name_length_chk",
      sql`char_length(${table.internalName}) BETWEEN 1 AND 120`,
    ),
    check("events_capacity_positive_chk", sql`${table.capacity} > 0`),
    check(
      "events_reserved_within_capacity_chk",
      sql`${table.reservedSeats} >= 0 AND ${table.reservedSeats} <= ${table.capacity}`,
    ),
    check(
      "events_max_party_within_capacity_chk",
      sql`${table.maxPartySize} >= 1 AND ${table.maxPartySize} <= ${table.capacity}`,
    ),
    check("events_window_order_chk", sql`${table.closesAt} > ${table.opensAt}`),
    check("events_reservation_number_nonnegative_chk", sql`${table.lastReservationNumber} >= 0`),
    index("events_status_opens_at_idx").on(table.status, table.opensAt),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").notNull().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    reservationNumber: integer("reservation_number"),
    status: reservationStatus("status").notNull(),
    fullName: text("full_name").notNull(),
    instagramHandle: text("instagram_handle").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    partySize: integer("party_size").notNull(),
    notes: text("notes"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "reservations_pkey", columns: [table.id] }),
    foreignKey({
      name: "reservations_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    unique("reservations_event_number_uq").on(table.eventId, table.reservationNumber),
    unique("reservations_idempotency_key_uq").on(table.idempotencyKey),
    check(
      "reservations_full_name_length_chk",
      sql`char_length(${table.fullName}) BETWEEN 1 AND 120`,
    ),
    check("reservations_party_size_positive_chk", sql`${table.partySize} >= 1`),
    check(
      "reservations_notes_length_chk",
      sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 500`,
    ),
    check(
      "reservations_confirmed_fields_chk",
      sql`${table.status} <> 'CONFIRMED' OR (${table.reservationNumber} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL)`,
    ),
    check(
      "reservations_full_rejected_fields_chk",
      sql`${table.status} <> 'FULL_REJECTED' OR (${table.reservationNumber} IS NULL AND ${table.acceptedAt} IS NULL)`,
    ),
    check(
      "reservations_cancelled_timestamp_chk",
      sql`${table.status} <> 'CANCELLED' OR ${table.cancelledAt} IS NOT NULL`,
    ),
    uniqueIndex("reservations_one_confirmed_per_email_uq")
      .on(table.eventId, table.emailNormalized)
      .where(sql`${table.status} = 'CONFIRMED'`),
    uniqueIndex("reservations_one_confirmed_per_phone_uq")
      .on(table.eventId, table.phoneE164)
      .where(sql`${table.status} = 'CONFIRMED'`),
    index("reservations_event_status_idx").on(table.eventId, table.status),
    index("reservations_event_submitted_at_idx").on(table.eventId, table.submittedAt),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    key: uuid("key").notNull(),
    scope: text("scope").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    reservationId: uuid("reservation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "idempotency_records_pkey", columns: [table.key] }),
    foreignKey({
      name: "idempotency_records_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("no action"),
    check(
      "idempotency_records_completion_chk",
      sql`(${table.completedAt} IS NULL) = (${table.responseStatus} IS NULL)`,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: actorType("actor_type").notNull(),
    actorAdminId: uuid("actor_admin_id"),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    primaryKey({ name: "audit_logs_pkey", columns: [table.id] }),
    foreignKey({
      name: "audit_logs_actor_admin_fk",
      columns: [table.actorAdminId],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check(
      "audit_logs_admin_actor_chk",
      sql`(${table.actorType} = 'ADMIN') = (${table.actorAdminId} IS NOT NULL)`,
    ),
    check(
      "audit_logs_entity_type_chk",
      sql`${table.entityType} IN ('EVENT', 'RESERVATION', 'ADMIN_USER')`,
    ),
    index("audit_logs_entity_occurred_at_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
    ),
    index("audit_logs_occurred_at_idx").on(table.occurredAt.desc()),
  ],
);

export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull(),
  },
  (table) => [
    primaryKey({
      name: "rate_limit_counters_pkey",
      columns: [table.bucketKey, table.windowStart],
    }),
    index("rate_limit_counters_window_start_idx").on(table.windowStart),
  ],
);
