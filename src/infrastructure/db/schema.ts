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
  smallint,
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
  "EVENT_DELETED",
  "DRINK_CREATED",
  "DRINK_UPDATED",
  "DRINK_DELETED",
  "RESERVATION_ON_LIST",
  "RESERVATION_PAID",
  "RESERVATION_REJECTED",
  "RESERVATION_REFUNDED",
  "RESERVATION_UPDATED",
  "WAITLIST_UPDATED",
  "WAITLIST_REORDERED",
  "MESSAGE_TEMPLATE_UPDATED",
  "MESSAGING_CONTACT_LINKED",
  "MESSAGING_CONTACT_UNLINKED",
  "INSTAGRAM_CONNECTED",
  "INSTAGRAM_DISCONNECTED",
  "EXTRA_CREATED",
  "EXTRA_UPDATED",
  "EXTRA_DELETED",
  "CONSUMPTION_ADDED",
  "CONSUMPTION_VOIDED",
  "GUEST_TAB_SETTLED",
  "GUEST_TAB_REOPENED",
  "PAYMENT_SETTINGS_UPDATED",
  "MESSAGING_CONTACT_DELETED",
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

export const instagramConnection = pgTable(
  "instagram_connection",
  {
    id: smallint("id").primaryKey().default(1).notNull(),
    accountId: text("account_id").notNull(),
    username: text("username").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    tokenVersion: integer("token_version").default(1).notNull(),
    connectedByAdminId: uuid("connected_by_admin_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    tokenRefreshedAt: timestamp("token_refreshed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "instagram_connection_connected_by_admin_fk",
      columns: [table.connectedByAdminId],
      foreignColumns: [adminUsers.id],
    }).onDelete("set null"),
    check("instagram_connection_singleton", sql`${table.id} = 1`),
    check("instagram_connection_account_id_digits", sql`${table.accountId} ~ '^[0-9]+$'`),
  ],
);

export const paymentSettings = pgTable(
  "payment_settings",
  {
    id: smallint("id").primaryKey().default(1).notNull(),
    bankName: text("bank_name").notNull(),
    accountType: text("account_type").notNull(),
    accountNumber: text("account_number").notNull(),
    accountHolder: text("account_holder").notNull(),
    paymentLink: text("payment_link"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    foreignKey({
      name: "payment_settings_updated_by_admin_fk",
      columns: [table.updatedBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("set null"),
    check("payment_settings_singleton", sql`${table.id} = 1`),
    check(
      "payment_settings_bank_name_length_chk",
      sql`char_length(${table.bankName}) BETWEEN 1 AND 80`,
    ),
    check(
      "payment_settings_account_type_chk",
      sql`${table.accountType} IN ('Ahorro', 'Corriente')`,
    ),
    check(
      "payment_settings_account_number_length_chk",
      sql`char_length(${table.accountNumber}) BETWEEN 1 AND 80`,
    ),
    check(
      "payment_settings_account_holder_length_chk",
      sql`char_length(${table.accountHolder}) BETWEEN 1 AND 80`,
    ),
    check(
      "payment_settings_payment_link_chk",
      sql`${table.paymentLink} IS NULL OR (char_length(${table.paymentLink}) BETWEEN 1 AND 300 AND (${table.paymentLink} !~* '^http' OR ${table.paymentLink} ~* '^https://'))`,
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
    paymentInstructions: text("payment_instructions"),
    priceCents: integer("price_cents"),
    lastReservationNumber: integer("last_reservation_number").notNull().default(0),
    waitlistCapacity: integer("waitlist_capacity").notNull().default(5),
    waitlistedCount: integer("waitlisted_count").notNull().default(0),
    lastWaitlistNumber: integer("last_waitlist_number").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    personalDataPurgedAt: timestamp("personal_data_purged_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "events_pkey", columns: [table.id] }),
    uniqueIndex("events_slug_live_uq")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
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
    check(
      "events_payment_instructions_length_chk",
      sql`${table.paymentInstructions} IS NULL OR char_length(${table.paymentInstructions}) BETWEEN 1 AND 600`,
    ),
    check("events_price_cents_chk", sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`),
    index("events_status_opens_at_idx").on(table.status, table.opensAt),
    index("events_personal_data_retention_idx")
      .on(table.startsAt, table.id)
      .where(sql`${table.personalDataPurgedAt} IS NULL`),
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

export const eventClues = pgTable(
  "event_clues",
  {
    id: uuid("id").notNull().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    primaryKey({ name: "event_clues_pkey", columns: [table.id] }),
    foreignKey({
      name: "event_clues_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "event_clues_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check("event_clues_body_length_chk", sql`char_length(${table.body}) BETWEEN 1 AND 500`),
    index("event_clues_event_created_at_idx").on(table.eventId, table.createdAt),
  ],
);

export const eventClueImages = pgTable(
  "event_clue_images",
  {
    id: uuid("id").notNull().defaultRandom(),
    clueId: uuid("clue_id").notNull(),
    position: smallint("position").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "event_clue_images_pkey", columns: [table.id] }),
    foreignKey({
      name: "event_clue_images_clue_fk",
      columns: [table.clueId],
      foreignColumns: [eventClues.id],
    }).onDelete("cascade"),
    unique("event_clue_images_clue_position_uq").on(table.clueId, table.position),
    check("event_clue_images_position_chk", sql`${table.position} BETWEEN 0 AND 2`),
    check(
      "event_clue_images_content_type_chk",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("event_clue_images_byte_size_chk", sql`${table.byteSize} BETWEEN 1 AND 1048576`),
    check("event_clue_images_data_size_chk", sql`octet_length(${table.data}) = ${table.byteSize}`),
  ],
);

export const messagingContacts = pgTable(
  "messaging_contacts",
  {
    id: uuid("id").notNull().defaultRandom(),
    instagramScopedId: text("instagram_scoped_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    adminReadAt: timestamp("admin_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "messaging_contacts_pkey", columns: [table.id] }),
    unique("messaging_contacts_instagram_scoped_id_uq").on(table.instagramScopedId),
    check(
      "messaging_contacts_instagram_scoped_id_chk",
      sql`${table.instagramScopedId} ~ '^[0-9]{1,32}$'`,
    ),
    check(
      "messaging_contacts_username_chk",
      sql`${table.username} IS NULL OR ${table.username} ~ '^[a-z0-9._]{1,30}$'`,
    ),
    check(
      "messaging_contacts_display_name_chk",
      sql`${table.displayName} IS NULL OR char_length(${table.displayName}) BETWEEN 1 AND 120`,
    ),
    index("messaging_contacts_username_idx").on(table.username),
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
    phoneE164: text("phone_e164"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    partySize: integer("party_size").notNull(),
    notes: text("notes"),
    allergies: text("allergies"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    linkCode: text("link_code"),
    contactId: uuid("contact_id"),
    contactLinkedBy: text("contact_linked_by"),
    source: text("source").notNull().default("PUBLIC"),
    createdBy: uuid("created_by"),
    stage: text("stage").notNull().default("IN_REVIEW"),
    onListAt: timestamp("on_list_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentNote: text("payment_note"),
    releaseReason: text("release_reason"),
    refundStatus: text("refund_status"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
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
    foreignKey({
      name: "reservations_contact_fk",
      columns: [table.contactId],
      foreignColumns: [messagingContacts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "reservations_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    unique("reservations_event_number_uq").on(table.eventId, table.reservationNumber),
    unique("reservations_idempotency_key_uq").on(table.idempotencyKey),
    check(
      "reservations_full_name_length_chk",
      sql`char_length(${table.fullName}) BETWEEN 1 AND 120`,
    ),
    check("reservations_party_size_positive_chk", sql`${table.partySize} >= 1`),
    check(
      "reservations_link_code_chk",
      sql`${table.linkCode} IS NULL OR ${table.linkCode} ~ '^[A-HJ-NP-Z2-9]{6}$'`,
    ),
    check(
      "reservations_contact_linked_by_chk",
      sql`${table.contactLinkedBy} IS NULL OR ${table.contactLinkedBy} IN ('CODE', 'USERNAME', 'MANUAL')`,
    ),
    check(
      "reservations_contact_link_pair_chk",
      sql`(${table.contactId} IS NULL) = (${table.contactLinkedBy} IS NULL)`,
    ),
    check("reservations_source_chk", sql`${table.source} IN ('PUBLIC', 'ADMIN')`),
    check(
      "reservations_admin_source_chk",
      sql`(${table.source} = 'ADMIN') = (${table.createdBy} IS NOT NULL)`,
    ),
    check(
      "reservations_terms_chk",
      sql`${table.source} = 'ADMIN' OR ${table.termsAcceptedAt} IS NOT NULL`,
    ),
    check("reservations_stage_chk", sql`${table.stage} IN ('IN_REVIEW', 'ON_LIST', 'PAID')`),
    check(
      "reservations_payment_note_chk",
      sql`${table.paymentNote} IS NULL OR char_length(${table.paymentNote}) BETWEEN 1 AND 200`,
    ),
    check(
      "reservations_on_list_timestamp_chk",
      sql`${table.stage} = 'IN_REVIEW' OR ${table.onListAt} IS NOT NULL`,
    ),
    check(
      "reservations_paid_timestamp_chk",
      sql`${table.stage} <> 'PAID' OR ${table.paidAt} IS NOT NULL`,
    ),
    check(
      "reservations_release_reason_chk",
      sql`${table.releaseReason} IS NULL OR (${table.releaseReason} IN ('REJECTED', 'CANCELLED') AND ${table.status} = 'CANCELLED')`,
    ),
    check(
      "reservations_refund_status_chk",
      sql`${table.refundStatus} IS NULL OR (${table.refundStatus} IN ('PENDING', 'REFUNDED') AND ${table.status} = 'CANCELLED' AND ${table.stage} = 'PAID')`,
    ),
    check(
      "reservations_refunded_timestamp_chk",
      sql`${table.refundStatus} IS DISTINCT FROM 'REFUNDED' OR ${table.refundedAt} IS NOT NULL`,
    ),
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
    uniqueIndex("reservations_link_code_uq")
      .on(table.linkCode)
      .where(sql`${table.linkCode} IS NOT NULL`),
    index("reservations_contact_id_idx").on(table.contactId),
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
    phoneE164: text("phone_e164"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    partySize: integer("party_size").notNull(),
    notes: text("notes"),
    allergies: text("allergies"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    linkCode: text("link_code"),
    contactId: uuid("contact_id"),
    contactLinkedBy: text("contact_linked_by"),
    source: text("source").notNull().default("PUBLIC"),
    createdBy: uuid("created_by"),
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
    foreignKey({
      name: "waitlist_entries_contact_fk",
      columns: [table.contactId],
      foreignColumns: [messagingContacts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "waitlist_entries_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
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
      "waitlist_entries_link_code_chk",
      sql`${table.linkCode} IS NULL OR ${table.linkCode} ~ '^[A-HJ-NP-Z2-9]{6}$'`,
    ),
    check(
      "waitlist_entries_contact_linked_by_chk",
      sql`${table.contactLinkedBy} IS NULL OR ${table.contactLinkedBy} IN ('CODE', 'USERNAME', 'MANUAL')`,
    ),
    check(
      "waitlist_entries_contact_link_pair_chk",
      sql`(${table.contactId} IS NULL) = (${table.contactLinkedBy} IS NULL)`,
    ),
    check("waitlist_entries_source_chk", sql`${table.source} IN ('PUBLIC', 'ADMIN')`),
    check(
      "waitlist_entries_admin_source_chk",
      sql`(${table.source} = 'ADMIN') = (${table.createdBy} IS NOT NULL)`,
    ),
    check(
      "waitlist_entries_terms_chk",
      sql`${table.source} = 'ADMIN' OR ${table.termsAcceptedAt} IS NOT NULL`,
    ),
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
    uniqueIndex("waitlist_entries_link_code_uq")
      .on(table.linkCode)
      .where(sql`${table.linkCode} IS NOT NULL`),
    index("waitlist_entries_contact_id_idx").on(table.contactId),
    index("waitlist_entries_event_status_number_idx").on(
      table.eventId,
      table.status,
      table.waitlistNumber,
    ),
  ],
);

export const requestGuests = pgTable(
  "request_guests",
  {
    id: uuid("id").notNull().defaultRandom(),
    reservationId: uuid("reservation_id"),
    waitlistEntryId: uuid("waitlist_entry_id"),
    slot: smallint("slot").notNull(),
    fullName: text("full_name").notNull(),
    instagramHandle: text("instagram_handle").notNull(),
    contactId: uuid("contact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "request_guests_pkey", columns: [table.id] }),
    foreignKey({
      name: "request_guests_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "request_guests_waitlist_entry_fk",
      columns: [table.waitlistEntryId],
      foreignColumns: [waitlistEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "request_guests_contact_fk",
      columns: [table.contactId],
      foreignColumns: [messagingContacts.id],
    }).onDelete("set null"),
    check(
      "request_guests_subject_chk",
      sql`num_nonnulls(${table.reservationId}, ${table.waitlistEntryId}) = 1`,
    ),
    check("request_guests_slot_chk", sql`${table.slot} >= 2`),
    check("request_guests_full_name_chk", sql`char_length(${table.fullName}) BETWEEN 1 AND 120`),
    check("request_guests_instagram_chk", sql`${table.instagramHandle} ~ '^[a-z0-9._]{1,30}$'`),
    unique("request_guests_reservation_slot_uq").on(table.reservationId, table.slot),
    unique("request_guests_waitlist_entry_slot_uq").on(table.waitlistEntryId, table.slot),
    index("request_guests_contact_idx").on(table.contactId),
    index("request_guests_instagram_idx").on(table.instagramHandle),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").notNull().defaultRandom(),
    contactId: uuid("contact_id"),
    reservationId: uuid("reservation_id"),
    waitlistEntryId: uuid("waitlist_entry_id"),
    guestSlot: smallint("guest_slot").notNull().default(1),
    eventId: uuid("event_id"),
    direction: text("direction").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    body: text("body"),
    attachmentUrls: text("attachment_urls").array(),
    externalMessageId: text("external_message_id"),
    partsSent: smallint("parts_sent").notNull().default(0),
    externalPartIds: text("external_part_ids").array(),
    claimsWithoutProgress: smallint("claims_without_progress").notNull().default(0),
    locationRevision: integer("location_revision"),
    clueId: uuid("clue_id"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    handledBy: uuid("handled_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "messages_pkey", columns: [table.id] }),
    foreignKey({
      name: "messages_contact_fk",
      columns: [table.contactId],
      foreignColumns: [messagingContacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "messages_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("no action"),
    foreignKey({
      name: "messages_waitlist_entry_fk",
      columns: [table.waitlistEntryId],
      foreignColumns: [waitlistEntries.id],
    }).onDelete("no action"),
    foreignKey({
      name: "messages_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("no action"),
    foreignKey({
      name: "messages_clue_fk",
      columns: [table.clueId],
      foreignColumns: [eventClues.id],
    }).onDelete("set null"),
    foreignKey({
      name: "messages_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    foreignKey({
      name: "messages_handled_by_admin_fk",
      columns: [table.handledBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check("messages_guest_slot_chk", sql`${table.guestSlot} >= 1`),
    check(
      "messages_guest_slot_subject_chk",
      sql`${table.guestSlot} = 1 OR ${table.reservationId} IS NOT NULL`,
    ),
    check("messages_direction_chk", sql`${table.direction} IN ('OUTBOUND', 'INBOUND')`),
    check(
      "messages_kind_chk",
      sql`${table.kind} IN ('REQUEST_RECEIVED', 'WAITLISTED', 'PROMOTED', 'ON_LIST', 'PAID', 'REJECTED', 'CANCELLED_UNPAID', 'CANCELLED_PAID', 'REFUNDED', 'LOCATION', 'CLUE', 'FREE_TEXT', 'INBOUND')`,
    ),
    check(
      "messages_source_chk",
      sql`${table.source} IN ('SYSTEM', 'ADMIN', 'INSTAGRAM_APP', 'GUEST')`,
    ),
    check(
      "messages_status_chk",
      sql`${table.status} IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'SENT', 'READ', 'FAILED', 'SENT_MANUALLY', 'DISCARDED', 'RECEIVED')`,
    ),
    check(
      "messages_inbound_kind_chk",
      sql`(${table.direction} = 'INBOUND') = (${table.kind} = 'INBOUND')`,
    ),
    check(
      "messages_inbound_status_chk",
      sql`(${table.direction} = 'INBOUND') = (${table.status} = 'RECEIVED')`,
    ),
    check(
      "messages_inbound_source_chk",
      sql`(${table.direction} = 'INBOUND') = (${table.source} = 'GUEST')`,
    ),
    check(
      "messages_inbound_contact_chk",
      sql`${table.direction} = 'OUTBOUND' OR ${table.contactId} IS NOT NULL`,
    ),
    check(
      "messages_delivery_contact_chk",
      sql`${table.status} NOT IN ('WAITING_WINDOW', 'QUEUED', 'SENT', 'READ') OR ${table.contactId} IS NOT NULL`,
    ),
    check(
      "messages_single_subject_chk",
      sql`num_nonnulls(${table.reservationId}, ${table.waitlistEntryId}) <= 1`,
    ),
    check(
      "messages_sent_timestamp_chk",
      sql`${table.status} NOT IN ('SENT', 'READ', 'SENT_MANUALLY') OR ${table.sentAt} IS NOT NULL`,
    ),
    check(
      "messages_read_timestamp_chk",
      sql`${table.status} <> 'READ' OR ${table.readAt} IS NOT NULL`,
    ),
    check(
      "messages_body_length_chk",
      sql`${table.body} IS NULL OR char_length(${table.body}) BETWEEN 1 AND 2000`,
    ),
    check(
      "messages_attachment_urls_chk",
      sql`${table.attachmentUrls} IS NULL OR cardinality(${table.attachmentUrls}) BETWEEN 1 AND 10`,
    ),
    check(
      "messages_content_chk",
      sql`${table.body} IS NOT NULL OR ${table.attachmentUrls} IS NOT NULL`,
    ),
    check(
      "messages_location_revision_chk",
      sql`(${table.kind} = 'LOCATION') = (${table.locationRevision} IS NOT NULL)`,
    ),
    check("messages_attempts_chk", sql`${table.attempts} >= 0`),
    check("messages_parts_sent_chk", sql`${table.partsSent} >= 0`),
    check("messages_claims_without_progress_chk", sql`${table.claimsWithoutProgress} >= 0`),
    check(
      "messages_external_part_ids_chk",
      sql`${table.externalPartIds} IS NULL OR cardinality(${table.externalPartIds}) BETWEEN 1 AND 20`,
    ),
    check(
      "messages_last_error_chk",
      sql`${table.lastError} IS NULL OR char_length(${table.lastError}) <= 200`,
    ),
    uniqueIndex("messages_external_message_id_uq")
      .on(table.externalMessageId)
      .where(sql`${table.externalMessageId} IS NOT NULL`),
    index("messages_contact_created_at_idx").on(table.contactId, table.createdAt),
    index("messages_reservation_created_at_idx").on(table.reservationId, table.createdAt),
    index("messages_waitlist_entry_created_at_idx").on(table.waitlistEntryId, table.createdAt),
    index("messages_event_kind_idx").on(table.eventId, table.kind),
    index("messages_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'QUEUED'`),
    index("messages_waiting_idx")
      .on(table.status)
      .where(sql`${table.status} IN ('WAITING_CONTACT', 'WAITING_WINDOW')`),
    uniqueIndex("messages_location_revision_uq")
      .on(table.reservationId, table.guestSlot, table.locationRevision)
      .where(sql`${table.kind} = 'LOCATION'`),
    uniqueIndex("messages_clue_uq")
      .on(table.reservationId, table.guestSlot, table.clueId)
      .where(sql`${table.kind} = 'CLUE'`),
  ],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").notNull().defaultRandom(),
    messageId: uuid("message_id").notNull(),
    position: smallint("position").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "message_attachments_pkey", columns: [table.id] }),
    foreignKey({
      name: "message_attachments_message_fk",
      columns: [table.messageId],
      foreignColumns: [messages.id],
    }).onDelete("cascade"),
    unique("message_attachments_message_position_uq").on(table.messageId, table.position),
    check("message_attachments_position_chk", sql`${table.position} BETWEEN 0 AND 9`),
    check(
      "message_attachments_content_type_chk",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`,
    ),
    check("message_attachments_byte_size_chk", sql`${table.byteSize} BETWEEN 1 AND 8388608`),
    check(
      "message_attachments_data_size_chk",
      sql`octet_length(${table.data}) = ${table.byteSize}`,
    ),
  ],
);

export const messageTemplates = pgTable(
  "message_templates",
  {
    key: text("key").notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    primaryKey({ name: "message_templates_pkey", columns: [table.key] }),
    foreignKey({
      name: "message_templates_updated_by_admin_fk",
      columns: [table.updatedBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check(
      "message_templates_key_chk",
      sql`${table.key} IN ('REQUEST_RECEIVED', 'WAITLISTED', 'PROMOTED', 'ON_LIST', 'PAID', 'REJECTED', 'CANCELLED_UNPAID', 'CANCELLED_PAID', 'REFUNDED', 'LOCATION', 'TAB')`,
    ),
    check("message_templates_body_chk", sql`char_length(${table.body}) BETWEEN 1 AND 1000`),
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
      sql`${table.entityType} IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK', 'MESSAGE_TEMPLATE', 'MESSAGING_CONTACT', 'INSTAGRAM_CONNECTION', 'EXTRA', 'GUEST_CONSUMPTION', 'GUEST_TAB', 'PAYMENT_SETTINGS')`,
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

export const drinks = pgTable(
  "drinks",
  {
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    primaryKey({ name: "drinks_pkey", columns: [table.id] }),
    foreignKey({
      name: "drinks_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check("drinks_name_length_chk", sql`char_length(${table.name}) BETWEEN 1 AND 80`),
    check(
      "drinks_description_length_chk",
      sql`${table.description} IS NULL OR char_length(${table.description}) BETWEEN 1 AND 280`,
    ),
    check("drinks_price_cents_chk", sql`${table.priceCents} BETWEEN 1 AND 999999`),
  ],
);

export const drinkImages = pgTable(
  "drink_images",
  {
    id: uuid("id").notNull().defaultRandom(),
    drinkId: uuid("drink_id").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    primaryKey({ name: "drink_images_pkey", columns: [table.id] }),
    foreignKey({
      name: "drink_images_drink_fk",
      columns: [table.drinkId],
      foreignColumns: [drinks.id],
    }).onDelete("cascade"),
    unique("drink_images_drink_uq").on(table.drinkId),
    foreignKey({
      name: "drink_images_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("no action"),
    check(
      "drink_images_content_type_chk",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("drink_images_byte_size_chk", sql`${table.byteSize} BETWEEN 1 AND 2097152`),
    check("drink_images_data_size_chk", sql`octet_length(${table.data}) = ${table.byteSize}`),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: uuid("id").notNull().defaultRandom(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "extras_pkey", columns: [table.id] }),
    check("extras_name_length_chk", sql`char_length(${table.name}) BETWEEN 1 AND 80`),
    check("extras_price_cents_chk", sql`${table.priceCents} BETWEEN 0 AND 10000000`),
  ],
);

export const guestConsumptions = pgTable(
  "guest_consumptions",
  {
    id: uuid("id").notNull().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    guestSlot: smallint("guest_slot").notNull(),
    source: text("source").notNull(),
    drinkId: uuid("drink_id"),
    extraId: uuid("extra_id"),
    itemName: text("item_name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by"),
  },
  (table) => [
    primaryKey({ name: "guest_consumptions_pkey", columns: [table.id] }),
    foreignKey({
      name: "guest_consumptions_event_fk",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guest_consumptions_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guest_consumptions_drink_fk",
      columns: [table.drinkId],
      foreignColumns: [drinks.id],
    }).onDelete("set null"),
    foreignKey({
      name: "guest_consumptions_extra_fk",
      columns: [table.extraId],
      foreignColumns: [extras.id],
    }).onDelete("set null"),
    foreignKey({
      name: "guest_consumptions_created_by_admin_fk",
      columns: [table.createdBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("set null"),
    foreignKey({
      name: "guest_consumptions_voided_by_admin_fk",
      columns: [table.voidedBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("set null"),
    check("guest_consumptions_guest_slot_chk", sql`${table.guestSlot} >= 1`),
    check("guest_consumptions_source_chk", sql`${table.source} IN ('DRINK', 'EXTRA', 'CUSTOM')`),
    // The item reference is cleared when a drink is deleted, so only the opposite direction is enforced.
    check(
      "guest_consumptions_source_reference_chk",
      sql`(${table.drinkId} IS NULL OR ${table.source} = 'DRINK') AND (${table.extraId} IS NULL OR ${table.source} = 'EXTRA')`,
    ),
    check(
      "guest_consumptions_item_name_length_chk",
      sql`char_length(${table.itemName}) BETWEEN 1 AND 80`,
    ),
    check("guest_consumptions_unit_price_chk", sql`${table.unitPriceCents} BETWEEN 0 AND 10000000`),
    check("guest_consumptions_quantity_chk", sql`${table.quantity} BETWEEN 1 AND 99`),
    check(
      "guest_consumptions_voided_pair_chk",
      sql`${table.voidedAt} IS NOT NULL OR ${table.voidedBy} IS NULL`,
    ),
    index("guest_consumptions_tab_idx")
      .on(table.eventId, table.reservationId, table.guestSlot)
      .where(sql`${table.voidedAt} IS NULL`),
  ],
);

export const guestTabs = pgTable(
  "guest_tabs",
  {
    reservationId: uuid("reservation_id").notNull(),
    guestSlot: smallint("guest_slot").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledBy: uuid("settled_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "guest_tabs_pkey", columns: [table.reservationId, table.guestSlot] }),
    foreignKey({
      name: "guest_tabs_reservation_fk",
      columns: [table.reservationId],
      foreignColumns: [reservations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "guest_tabs_settled_by_admin_fk",
      columns: [table.settledBy],
      foreignColumns: [adminUsers.id],
    }).onDelete("set null"),
    check("guest_tabs_guest_slot_chk", sql`${table.guestSlot} >= 1`),
  ],
);
