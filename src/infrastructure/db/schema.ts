import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
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

export const eventLocationStatus = pgEnum("event_location_status", ["PENDING", "CONFIRMED"]);

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

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
  "ADMIN_USER_CREATED",
  "ADMIN_USER_UPDATED",
  "ADMIN_USER_DEACTIVATED",
  "ADMIN_USER_REACTIVATED",
  "ADMIN_PASSWORD_RESET",
  "ADMIN_PASSWORD_CHANGED",
  "ADMIN_SESSIONS_REVOKED",
  "ADMIN_USER_DELETION_REQUESTED",
  "ADMIN_USER_DELETED",
  "RESERVATION_WAITLISTED",
  "WAITLIST_PROMOTED",
  "WAITLIST_CANCELLED",
  "ADMIN_PASSWORD_RESET_REQUESTED",
  "ADMIN_PASSWORD_RESET_COMPLETED",
]);

export const actorType = pgEnum("actor_type", ["ADMIN", "PUBLIC", "SYSTEM"]);

export const adminRole = pgEnum("admin_role", ["SUPER_ADMIN", "ADMIN"]);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").notNull().defaultRandom(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: adminRole("role").notNull().default("ADMIN"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "admin_users_pkey", columns: [table.id] }),
    uniqueIndex("admin_users_email_normalized_live_uq")
      .on(table.emailNormalized)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      "admin_users_deleted_inactive_chk",
      sql`${table.deletedAt} IS NULL OR ${table.isActive} = false`,
    ),
  ],
);

export const adminActionCodes = pgTable(
  "admin_action_codes",
  {
    id: uuid("id").notNull().defaultRandom(),
    purpose: text("purpose").notNull(),
    actorAdminId: uuid("actor_admin_id").notNull(),
    targetAdminId: uuid("target_admin_id").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "admin_action_codes_pkey", columns: [table.id] }),
    foreignKey({
      name: "admin_action_codes_actor_admin_fk",
      columns: [table.actorAdminId],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    foreignKey({
      name: "admin_action_codes_target_admin_fk",
      columns: [table.targetAdminId],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check("admin_action_codes_purpose_chk", sql`${table.purpose} IN ('ADMIN_USER_DELETE')`),
    check("admin_action_codes_attempts_chk", sql`${table.attempts} >= 0`),
    uniqueIndex("admin_action_codes_live_uq")
      .on(table.actorAdminId, table.targetAdminId, table.purpose)
      .where(sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`),
    index("admin_action_codes_target_admin_idx").on(table.targetAdminId),
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

export const adminPasswordResetTokens = pgTable(
  "admin_password_reset_tokens",
  {
    id: uuid("id").notNull().defaultRandom(),
    adminUserId: uuid("admin_user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "admin_password_reset_tokens_pkey", columns: [table.id] }),
    foreignKey({
      name: "admin_password_reset_tokens_admin_user_fk",
      columns: [table.adminUserId],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    unique("admin_password_reset_tokens_token_hash_uq").on(table.tokenHash),
    uniqueIndex("admin_password_reset_tokens_live_uq")
      .on(table.adminUserId)
      .where(sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`),
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
    locationName: text("location_name"),
    locationAddress: text("location_address"),
    locationMapsUrl: text("location_maps_url"),
    locationNotes: text("location_notes"),
    locationStatus: eventLocationStatus("location_status").notNull().default("PENDING"),
    locationConfirmedAt: timestamp("location_confirmed_at", { withTimezone: true }),
    locationRevision: integer("location_revision").notNull().default(0),
    locationReleasedRevision: integer("location_released_revision"),
    locationLatitude: doublePrecision("location_latitude"),
    locationLongitude: doublePrecision("location_longitude"),
    lastReservationNumber: integer("last_reservation_number").notNull().default(0),
    waitlistCapacity: integer("waitlist_capacity").notNull().default(5),
    waitlistedCount: integer("waitlisted_count").notNull().default(0),
    lastWaitlistNumber: integer("last_waitlist_number").notNull().default(0),
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
    check("events_waitlist_capacity_chk", sql`${table.waitlistCapacity} BETWEEN 0 AND 50`),
    check(
      "events_waitlisted_within_capacity_chk",
      sql`${table.waitlistedCount} >= 0 AND ${table.waitlistedCount} <= ${table.waitlistCapacity}`,
    ),
    check("events_waitlist_number_nonnegative_chk", sql`${table.lastWaitlistNumber} >= 0`),
    check(
      "events_location_name_length_chk",
      sql`${table.locationName} IS NULL OR char_length(${table.locationName}) BETWEEN 1 AND 120`,
    ),
    check(
      "events_location_address_length_chk",
      sql`${table.locationAddress} IS NULL OR char_length(${table.locationAddress}) BETWEEN 1 AND 300`,
    ),
    check(
      "events_location_maps_url_chk",
      sql`${table.locationMapsUrl} IS NULL OR (char_length(${table.locationMapsUrl}) BETWEEN 1 AND 2048 AND ${table.locationMapsUrl} LIKE 'https://%')`,
    ),
    check(
      "events_location_notes_length_chk",
      sql`${table.locationNotes} IS NULL OR char_length(${table.locationNotes}) BETWEEN 1 AND 1000`,
    ),
    check(
      "events_location_confirmation_timestamp_chk",
      sql`(${table.locationStatus} = 'CONFIRMED') = (${table.locationConfirmedAt} IS NOT NULL)`,
    ),
    check(
      "events_location_confirmation_complete_chk",
      sql`${table.locationStatus} <> 'CONFIRMED' OR ${table.locationAddress} IS NOT NULL OR ${table.locationMapsUrl} IS NOT NULL`,
    ),
    check("events_location_revision_nonnegative_chk", sql`${table.locationRevision} >= 0`),
    check(
      "events_location_released_revision_chk",
      sql`${table.locationReleasedRevision} IS NULL OR (${table.locationReleasedRevision} >= 0 AND ${table.locationReleasedRevision} <= ${table.locationRevision})`,
    ),
    check(
      "events_location_coordinates_pair_chk",
      sql`(${table.locationLatitude} IS NULL) = (${table.locationLongitude} IS NULL)`,
    ),
    check(
      "events_location_latitude_chk",
      sql`${table.locationLatitude} IS NULL OR ${table.locationLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      "events_location_longitude_chk",
      sql`${table.locationLongitude} IS NULL OR ${table.locationLongitude} BETWEEN -180 AND 180`,
    ),
    index("events_status_opens_at_idx").on(table.status, table.opensAt),
  ],
);

export const eventImages = pgTable(
  "event_images",
  {
    id: uuid("id").notNull().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    data: bytea("data").notNull(),
    publicToken: text("public_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    primaryKey({ name: "event_images_pkey", columns: [table.id] }),
    foreignKey({
      name: "event_images_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "event_images_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    unique("event_images_public_token_uq").on(table.publicToken),
    check(
      "event_images_content_type_chk",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("event_images_byte_size_chk", sql`${table.byteSize} BETWEEN 1 AND 2097152`),
    check("event_images_data_size_chk", sql`octet_length(${table.data}) = ${table.byteSize}`),
    check("event_images_public_token_length_chk", sql`char_length(${table.publicToken}) = 43`),
    index("event_images_event_created_at_idx").on(table.eventId, table.createdAt),
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
    allergies: text("allergies"),
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
      "reservations_allergies_length_chk",
      sql`${table.allergies} IS NULL OR char_length(${table.allergies}) BETWEEN 1 AND 300`,
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

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").notNull().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    waitlistNumber: integer("waitlist_number").notNull(),
    status: text("status").notNull(),
    fullName: text("full_name").notNull(),
    instagramHandle: text("instagram_handle").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    partySize: integer("party_size").notNull(),
    notes: text("notes"),
    allergies: text("allergies"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    promotedReservationId: uuid("promoted_reservation_id"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "waitlist_entries_pkey", columns: [table.id] }),
    foreignKey({
      name: "waitlist_entries_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "waitlist_entries_promoted_reservation_fk",
      columns: [table.promotedReservationId],
      foreignColumns: [reservations.id],
    }).onDelete("no action"),
    unique("waitlist_entries_event_number_uq").on(table.eventId, table.waitlistNumber),
    unique("waitlist_entries_idempotency_key_uq").on(table.idempotencyKey),
    unique("waitlist_entries_promoted_reservation_id_uq").on(table.promotedReservationId),
    check(
      "waitlist_entries_status_chk",
      sql`${table.status} IN ('WAITING', 'PROMOTED', 'CANCELLED')`,
    ),
    check(
      "waitlist_entries_full_name_length_chk",
      sql`char_length(${table.fullName}) BETWEEN 1 AND 120`,
    ),
    check("waitlist_entries_party_size_positive_chk", sql`${table.partySize} >= 1`),
    check(
      "waitlist_entries_notes_length_chk",
      sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 500`,
    ),
    check(
      "waitlist_entries_allergies_length_chk",
      sql`${table.allergies} IS NULL OR char_length(${table.allergies}) BETWEEN 1 AND 300`,
    ),
    check(
      "waitlist_entries_promoted_fields_chk",
      sql`${table.status} <> 'PROMOTED' OR (${table.promotedReservationId} IS NOT NULL AND ${table.promotedAt} IS NOT NULL)`,
    ),
    check(
      "waitlist_entries_cancelled_timestamp_chk",
      sql`${table.status} <> 'CANCELLED' OR ${table.cancelledAt} IS NOT NULL`,
    ),
    uniqueIndex("waitlist_entries_one_waiting_per_email_uq")
      .on(table.eventId, table.emailNormalized)
      .where(sql`${table.status} = 'WAITING'`),
    uniqueIndex("waitlist_entries_one_waiting_per_phone_uq")
      .on(table.eventId, table.phoneE164)
      .where(sql`${table.status} = 'WAITING'`),
    index("waitlist_entries_event_status_number_idx").on(
      table.eventId,
      table.status,
      table.waitlistNumber,
    ),
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
    waitlistEntryId: uuid("waitlist_entry_id"),
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
    foreignKey({
      name: "idempotency_records_waitlist_entry_fk",
      columns: [table.waitlistEntryId],
      foreignColumns: [waitlistEntries.id],
    }).onDelete("no action"),
    check(
      "idempotency_records_completion_chk",
      sql`(${table.completedAt} IS NULL) = (${table.responseStatus} IS NULL)`,
    ),
    check(
      "idempotency_records_single_subject_chk",
      sql`${table.reservationId} IS NULL OR ${table.waitlistEntryId} IS NULL`,
    ),
  ],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").notNull().defaultRandom(),
    kind: text("kind").notNull(),
    reservationId: uuid("reservation_id"),
    waitlistEntryId: uuid("waitlist_entry_id"),
    adminUserId: uuid("admin_user_id"),
    locationRevision: integer("location_revision"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "email_outbox_pkey", columns: [table.id] }),
    foreignKey({
      name: "email_outbox_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("no action"),
    foreignKey({
      name: "email_outbox_waitlist_entry_fk",
      columns: [table.waitlistEntryId],
      foreignColumns: [waitlistEntries.id],
    }).onDelete("no action"),
    foreignKey({
      name: "email_outbox_admin_user_fk",
      columns: [table.adminUserId],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check(
      "email_outbox_kind_chk",
      sql`${table.kind} IN ('RESERVATION_CONFIRMED', 'RESERVATION_WAITLISTED', 'WAITLIST_PROMOTED', 'RESERVATION_CANCELLED', 'WAITLIST_CANCELLED', 'EVENT_LOCATION', 'ADMIN_ADDED', 'ADMIN_SIGNED_IN', 'ADMIN_PASSWORD_RESET_BY_ADMIN', 'ADMIN_PASSWORD_CHANGED', 'ADMIN_PASSWORD_RESET_COMPLETED', 'ADMIN_DEACTIVATED', 'ADMIN_REACTIVATED', 'ADMIN_ROLE_CHANGED', 'ADMIN_DELETED', 'ADMIN_SESSIONS_REVOKED')`,
    ),
    check("email_outbox_status_chk", sql`${table.status} IN ('PENDING', 'SENT', 'FAILED')`),
    check("email_outbox_attempts_chk", sql`${table.attempts} >= 0`),
    check(
      "email_outbox_last_error_length_chk",
      sql`${table.lastError} IS NULL OR char_length(${table.lastError}) <= 200`,
    ),
    check(
      "email_outbox_single_subject_chk",
      sql`num_nonnulls(${table.reservationId}, ${table.waitlistEntryId}, ${table.adminUserId}) = 1`,
    ),
    check(
      "email_outbox_sent_timestamp_chk",
      sql`${table.status} <> 'SENT' OR ${table.sentAt} IS NOT NULL`,
    ),
    check(
      "email_outbox_location_revision_chk",
      sql`(${table.kind} = 'EVENT_LOCATION') = (${table.locationRevision} IS NOT NULL)`,
    ),
    uniqueIndex("email_outbox_reservation_kind_uq")
      .on(table.kind, table.reservationId)
      .where(sql`${table.reservationId} IS NOT NULL AND ${table.kind} <> 'EVENT_LOCATION'`),
    uniqueIndex("email_outbox_location_revision_uq")
      .on(table.reservationId, table.locationRevision)
      .where(sql`${table.kind} = 'EVENT_LOCATION'`),
    uniqueIndex("email_outbox_waitlist_kind_uq")
      .on(table.kind, table.waitlistEntryId)
      .where(sql`${table.waitlistEntryId} IS NOT NULL`),
    index("email_outbox_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'PENDING'`),
    index("email_outbox_reservation_id_idx").on(table.reservationId),
    index("email_outbox_waitlist_entry_id_idx").on(table.waitlistEntryId),
    index("email_outbox_admin_user_id_idx").on(table.adminUserId),
    index("email_outbox_created_at_idx").on(table.createdAt.desc()),
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
      sql`${table.entityType} IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY')`,
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
