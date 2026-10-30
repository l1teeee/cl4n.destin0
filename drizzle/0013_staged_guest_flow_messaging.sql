ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_ON_LIST';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_PAID';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_REJECTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_REFUNDED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'WAITLIST_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'WAITLIST_REORDERED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'MESSAGE_TEMPLATE_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'MESSAGING_CONTACT_LINKED';--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_pkey" PRIMARY KEY("id"),
	CONSTRAINT "message_attachments_message_position_uq" UNIQUE("message_id","position"),
	CONSTRAINT "message_attachments_position_chk" CHECK ("message_attachments"."position" BETWEEN 0 AND 9),
	CONSTRAINT "message_attachments_content_type_chk" CHECK ("message_attachments"."content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
	CONSTRAINT "message_attachments_byte_size_chk" CHECK ("message_attachments"."byte_size" BETWEEN 1 AND 8388608),
	CONSTRAINT "message_attachments_data_size_chk" CHECK (octet_length("message_attachments"."data") = "message_attachments"."byte_size")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"key" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "message_templates_pkey" PRIMARY KEY("key"),
	CONSTRAINT "message_templates_key_chk" CHECK ("message_templates"."key" IN ('REQUEST_RECEIVED', 'WAITLISTED', 'PROMOTED', 'ON_LIST', 'PAID', 'REJECTED', 'CANCELLED_UNPAID', 'CANCELLED_PAID', 'REFUNDED', 'LOCATION')),
	CONSTRAINT "message_templates_body_chk" CHECK (char_length("message_templates"."body") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"reservation_id" uuid,
	"waitlist_entry_id" uuid,
	"event_id" uuid,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"body" text,
	"attachment_urls" text[],
	"external_message_id" text,
	"location_revision" integer,
	"clue_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_by" uuid,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_pkey" PRIMARY KEY("id"),
	CONSTRAINT "messages_direction_chk" CHECK ("messages"."direction" IN ('OUTBOUND', 'INBOUND')),
	CONSTRAINT "messages_kind_chk" CHECK ("messages"."kind" IN ('REQUEST_RECEIVED', 'WAITLISTED', 'PROMOTED', 'ON_LIST', 'PAID', 'REJECTED', 'CANCELLED_UNPAID', 'CANCELLED_PAID', 'REFUNDED', 'LOCATION', 'CLUE', 'FREE_TEXT', 'INBOUND')),
	CONSTRAINT "messages_source_chk" CHECK ("messages"."source" IN ('SYSTEM', 'ADMIN', 'INSTAGRAM_APP', 'GUEST')),
	CONSTRAINT "messages_status_chk" CHECK ("messages"."status" IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'SENT', 'READ', 'FAILED', 'SENT_MANUALLY', 'DISCARDED', 'RECEIVED')),
	CONSTRAINT "messages_inbound_kind_chk" CHECK (("messages"."direction" = 'INBOUND') = ("messages"."kind" = 'INBOUND')),
	CONSTRAINT "messages_inbound_status_chk" CHECK (("messages"."direction" = 'INBOUND') = ("messages"."status" = 'RECEIVED')),
	CONSTRAINT "messages_inbound_source_chk" CHECK (("messages"."direction" = 'INBOUND') = ("messages"."source" = 'GUEST')),
	CONSTRAINT "messages_inbound_contact_chk" CHECK ("messages"."direction" = 'OUTBOUND' OR "messages"."contact_id" IS NOT NULL),
	CONSTRAINT "messages_delivery_contact_chk" CHECK ("messages"."status" NOT IN ('WAITING_WINDOW', 'QUEUED', 'SENT', 'READ') OR "messages"."contact_id" IS NOT NULL),
	CONSTRAINT "messages_single_subject_chk" CHECK (num_nonnulls("messages"."reservation_id", "messages"."waitlist_entry_id") <= 1),
	CONSTRAINT "messages_sent_timestamp_chk" CHECK ("messages"."status" NOT IN ('SENT', 'READ', 'SENT_MANUALLY') OR "messages"."sent_at" IS NOT NULL),
	CONSTRAINT "messages_read_timestamp_chk" CHECK ("messages"."status" <> 'READ' OR "messages"."read_at" IS NOT NULL),
	CONSTRAINT "messages_body_length_chk" CHECK ("messages"."body" IS NULL OR char_length("messages"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "messages_attachment_urls_chk" CHECK ("messages"."attachment_urls" IS NULL OR cardinality("messages"."attachment_urls") BETWEEN 1 AND 10),
	CONSTRAINT "messages_content_chk" CHECK ("messages"."body" IS NOT NULL OR "messages"."attachment_urls" IS NOT NULL),
	CONSTRAINT "messages_location_revision_chk" CHECK (("messages"."kind" = 'LOCATION') = ("messages"."location_revision" IS NOT NULL)),
	CONSTRAINT "messages_attempts_chk" CHECK ("messages"."attempts" >= 0),
	CONSTRAINT "messages_last_error_chk" CHECK ("messages"."last_error" IS NULL OR char_length("messages"."last_error") <= 200)
);
--> statement-breakpoint
CREATE TABLE "messaging_contacts" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"instagram_scoped_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"last_inbound_at" timestamp with time zone,
	"admin_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_contacts_pkey" PRIMARY KEY("id"),
	CONSTRAINT "messaging_contacts_instagram_scoped_id_uq" UNIQUE("instagram_scoped_id"),
	CONSTRAINT "messaging_contacts_instagram_scoped_id_chk" CHECK ("messaging_contacts"."instagram_scoped_id" ~ '^[0-9]{1,32}$'),
	CONSTRAINT "messaging_contacts_username_chk" CHECK ("messaging_contacts"."username" IS NULL OR "messaging_contacts"."username" ~ '^[a-z0-9._]{1,30}$'),
	CONSTRAINT "messaging_contacts_display_name_chk" CHECK ("messaging_contacts"."display_name" IS NULL OR char_length("messaging_contacts"."display_name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "email_normalized" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "terms_accepted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "phone_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "email_normalized" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "terms_accepted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_instructions" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "guest2_full_name" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "guest2_instagram_handle" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "link_code" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "source" text DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "stage" text DEFAULT 'IN_REVIEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "on_list_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_note" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "guest2_full_name" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "guest2_instagram_handle" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "link_code" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "source" text DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "created_by" uuid;--> statement-breakpoint
UPDATE reservations
   SET stage = 'PAID',
       on_list_at = accepted_at,
       paid_at = accepted_at
 WHERE status = 'CONFIRMED';--> statement-breakpoint
UPDATE reservations
   SET release_reason = 'CANCELLED'
 WHERE status = 'CANCELLED';--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_admin_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_waitlist_entry_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_clue_fk" FOREIGN KEY ("clue_id") REFERENCES "public"."event_clues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_handled_by_admin_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_message_id_uq" ON "messages" USING btree ("external_message_id") WHERE "messages"."external_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_contact_created_at_idx" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_reservation_created_at_idx" ON "messages" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_waitlist_entry_created_at_idx" ON "messages" USING btree ("waitlist_entry_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_event_kind_idx" ON "messages" USING btree ("event_id","kind");--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("next_attempt_at") WHERE "messages"."status" = 'QUEUED';--> statement-breakpoint
CREATE INDEX "messages_waiting_idx" ON "messages" USING btree ("status") WHERE "messages"."status" IN ('WAITING_CONTACT', 'WAITING_WINDOW');--> statement-breakpoint
CREATE UNIQUE INDEX "messages_location_revision_uq" ON "messages" USING btree ("reservation_id","location_revision") WHERE "messages"."kind" = 'LOCATION';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_clue_uq" ON "messages" USING btree ("reservation_id","clue_id") WHERE "messages"."kind" = 'CLUE';--> statement-breakpoint
CREATE INDEX "messaging_contacts_username_idx" ON "messaging_contacts" USING btree ("username");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_link_code_uq" ON "reservations" USING btree ("link_code") WHERE "reservations"."link_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reservations_contact_id_idx" ON "reservations" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_link_code_uq" ON "waitlist_entries" USING btree ("link_code") WHERE "waitlist_entries"."link_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "waitlist_entries_contact_id_idx" ON "waitlist_entries" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK', 'MESSAGE_TEMPLATE', 'MESSAGING_CONTACT'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payment_instructions_length_chk" CHECK ("events"."payment_instructions" IS NULL OR char_length("events"."payment_instructions") BETWEEN 1 AND 600);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_pair_chk" CHECK (("reservations"."guest2_full_name" IS NULL) = ("reservations"."guest2_instagram_handle" IS NULL));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_party_chk" CHECK ("reservations"."guest2_full_name" IS NULL OR ("reservations"."party_size" = 2 AND char_length("reservations"."guest2_full_name") BETWEEN 1 AND 120));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_instagram_chk" CHECK ("reservations"."guest2_instagram_handle" IS NULL OR "reservations"."guest2_instagram_handle" ~ '^[a-z0-9._]{1,30}$');--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_link_code_chk" CHECK ("reservations"."link_code" IS NULL OR "reservations"."link_code" ~ '^[A-HJ-NP-Z2-9]{6}$');--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_source_chk" CHECK ("reservations"."source" IN ('PUBLIC', 'ADMIN'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_admin_source_chk" CHECK (("reservations"."source" = 'ADMIN') = ("reservations"."created_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_terms_chk" CHECK ("reservations"."source" = 'ADMIN' OR "reservations"."terms_accepted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_stage_chk" CHECK ("reservations"."stage" IN ('IN_REVIEW', 'ON_LIST', 'PAID'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_payment_note_chk" CHECK ("reservations"."payment_note" IS NULL OR char_length("reservations"."payment_note") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_on_list_timestamp_chk" CHECK ("reservations"."stage" = 'IN_REVIEW' OR "reservations"."on_list_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_paid_timestamp_chk" CHECK ("reservations"."stage" <> 'PAID' OR "reservations"."paid_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_release_reason_chk" CHECK ("reservations"."release_reason" IS NULL OR ("reservations"."release_reason" IN ('REJECTED', 'CANCELLED') AND "reservations"."status" = 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_refund_status_chk" CHECK ("reservations"."refund_status" IS NULL OR ("reservations"."refund_status" IN ('PENDING', 'REFUNDED') AND "reservations"."status" = 'CANCELLED' AND "reservations"."stage" = 'PAID'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_refunded_timestamp_chk" CHECK ("reservations"."refund_status" IS DISTINCT FROM 'REFUNDED' OR "reservations"."refunded_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_guest2_pair_chk" CHECK (("waitlist_entries"."guest2_full_name" IS NULL) = ("waitlist_entries"."guest2_instagram_handle" IS NULL));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_guest2_party_chk" CHECK ("waitlist_entries"."guest2_full_name" IS NULL OR ("waitlist_entries"."party_size" = 2 AND char_length("waitlist_entries"."guest2_full_name") BETWEEN 1 AND 120));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_guest2_instagram_chk" CHECK ("waitlist_entries"."guest2_instagram_handle" IS NULL OR "waitlist_entries"."guest2_instagram_handle" ~ '^[a-z0-9._]{1,30}$');--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_link_code_chk" CHECK ("waitlist_entries"."link_code" IS NULL OR "waitlist_entries"."link_code" ~ '^[A-HJ-NP-Z2-9]{6}$');--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_source_chk" CHECK ("waitlist_entries"."source" IN ('PUBLIC', 'ADMIN'));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_admin_source_chk" CHECK (("waitlist_entries"."source" = 'ADMIN') = ("waitlist_entries"."created_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_terms_chk" CHECK ("waitlist_entries"."source" = 'ADMIN' OR "waitlist_entries"."terms_accepted_at" IS NOT NULL);--> statement-breakpoint
INSERT INTO message_templates (key, body)
VALUES
  ('REQUEST_RECEIVED', E'¡Felicidades, {nombre}! Completaste el formulario para la experiencia del {fecha}. Te confirmaremos por aquí para saber si estás en la lista.'),
  ('WAITLISTED', E'Hola, {nombre}. Completaste el formulario, pero el cupo ya se llenó: quedaste en la cola en la posición {posicion}. Si se libera un lugar te escribiremos por aquí.'),
  ('PROMOTED', E'¡Buenas noticias, {nombre}! Se liberó un lugar y ya estás en el listado de la experiencia del {fecha}. Te confirmaremos por aquí para saber si estás en la lista.'),
  ('ON_LIST', E'¡Felicidades, {nombre}, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.\n\n{pago}\n\nCuando transfieras, envíanos el comprobante por aquí.'),
  ('PAID', E'¡Felicidades, {nombre}! Tu lugar está confirmado para la experiencia del {fecha}. Por aquí te enviaremos las pistas y la ubicación. El día de la experiencia escríbenos para recibirlas a tiempo.'),
  ('REJECTED', E'Hola, {nombre}. Gracias por tu interés en Clandestino. Esta vez no pudimos darte un lugar, pero esperamos verte en una próxima experiencia.'),
  ('CANCELLED_UNPAID', E'Hola, {nombre}. Tu lugar para la experiencia del {fecha} quedó cancelado. Esperamos verte en una próxima experiencia.'),
  ('CANCELLED_PAID', E'Hola, {nombre}. Lamentablemente tu lugar para la experiencia del {fecha} se ha cancelado. Lo sentimos mucho. Te devolveremos el pago y te avisaremos por aquí cuando esté hecho.'),
  ('REFUNDED', E'Hola, {nombre}. Ya realizamos la devolución de tu pago. Gracias por tu paciencia; esperamos verte pronto.'),
  ('LOCATION', E'Esta es la ubicación de la experiencia del {fecha}:\n\n{ubicacion}\n\nNo la compartas con nadie.')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON messaging_contacts, messages, message_attachments TO clandestino_app;
    GRANT SELECT, INSERT, UPDATE ON message_templates TO clandestino_app;
  END IF;
END $$;
