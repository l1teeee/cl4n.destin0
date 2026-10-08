ALTER TYPE "public"."audit_action" ADD VALUE 'RESERVATION_WAITLISTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'WAITLIST_PROMOTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'WAITLIST_CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_PASSWORD_RESET_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_PASSWORD_RESET_COMPLETED';--> statement-breakpoint
CREATE TABLE "admin_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_password_reset_tokens_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"waitlist_number" integer NOT NULL,
	"status" text NOT NULL,
	"full_name" text NOT NULL,
	"instagram_handle" text NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"party_size" integer NOT NULL,
	"notes" text,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"promoted_reservation_id" uuid,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_event_number_uq" UNIQUE("event_id","waitlist_number"),
	CONSTRAINT "waitlist_entries_idempotency_key_uq" UNIQUE("idempotency_key"),
	CONSTRAINT "waitlist_entries_promoted_reservation_id_uq" UNIQUE("promoted_reservation_id"),
	CONSTRAINT "waitlist_entries_status_chk" CHECK ("waitlist_entries"."status" IN ('WAITING', 'PROMOTED', 'CANCELLED')),
	CONSTRAINT "waitlist_entries_full_name_length_chk" CHECK (char_length("waitlist_entries"."full_name") BETWEEN 1 AND 120),
	CONSTRAINT "waitlist_entries_party_size_positive_chk" CHECK ("waitlist_entries"."party_size" >= 1),
	CONSTRAINT "waitlist_entries_notes_length_chk" CHECK ("waitlist_entries"."notes" IS NULL OR char_length("waitlist_entries"."notes") <= 500),
	CONSTRAINT "waitlist_entries_promoted_fields_chk" CHECK ("waitlist_entries"."status" <> 'PROMOTED' OR ("waitlist_entries"."promoted_reservation_id" IS NOT NULL AND "waitlist_entries"."promoted_at" IS NOT NULL)),
	CONSTRAINT "waitlist_entries_cancelled_timestamp_chk" CHECK ("waitlist_entries"."status" <> 'CANCELLED' OR "waitlist_entries"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"reservation_id" uuid,
	"waitlist_entry_id" uuid,
	"admin_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_kind_chk" CHECK ("email_outbox"."kind" IN ('RESERVATION_CONFIRMED', 'RESERVATION_WAITLISTED', 'WAITLIST_PROMOTED', 'RESERVATION_CANCELLED', 'WAITLIST_CANCELLED', 'ADMIN_ADDED', 'ADMIN_SIGNED_IN', 'ADMIN_PASSWORD_RESET_BY_ADMIN', 'ADMIN_PASSWORD_CHANGED', 'ADMIN_PASSWORD_RESET_COMPLETED', 'ADMIN_DEACTIVATED', 'ADMIN_REACTIVATED', 'ADMIN_ROLE_CHANGED', 'ADMIN_DELETED', 'ADMIN_SESSIONS_REVOKED')),
	CONSTRAINT "email_outbox_status_chk" CHECK ("email_outbox"."status" IN ('PENDING', 'SENT', 'FAILED')),
	CONSTRAINT "email_outbox_attempts_chk" CHECK ("email_outbox"."attempts" >= 0),
	CONSTRAINT "email_outbox_last_error_length_chk" CHECK ("email_outbox"."last_error" IS NULL OR char_length("email_outbox"."last_error") <= 200),
	CONSTRAINT "email_outbox_single_subject_chk" CHECK (num_nonnulls("email_outbox"."reservation_id", "email_outbox"."waitlist_entry_id", "email_outbox"."admin_user_id") = 1),
	CONSTRAINT "email_outbox_sent_timestamp_chk" CHECK ("email_outbox"."status" <> 'SENT' OR "email_outbox"."sent_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "waitlist_capacity" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "waitlisted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "last_waitlist_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "waitlist_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_password_reset_tokens" ADD CONSTRAINT "admin_password_reset_tokens_admin_user_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_promoted_reservation_fk" FOREIGN KEY ("promoted_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_waitlist_entry_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_admin_user_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_password_reset_tokens_live_uq" ON "admin_password_reset_tokens" USING btree ("admin_user_id") WHERE "admin_password_reset_tokens"."consumed_at" IS NULL AND "admin_password_reset_tokens"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_one_waiting_per_email_uq" ON "waitlist_entries" USING btree ("event_id","email_normalized") WHERE "waitlist_entries"."status" = 'WAITING';--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_one_waiting_per_phone_uq" ON "waitlist_entries" USING btree ("event_id","phone_e164") WHERE "waitlist_entries"."status" = 'WAITING';--> statement-breakpoint
CREATE INDEX "waitlist_entries_event_status_number_idx" ON "waitlist_entries" USING btree ("event_id","status","waitlist_number");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_reservation_kind_uq" ON "email_outbox" USING btree ("kind","reservation_id") WHERE "email_outbox"."reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_waitlist_kind_uq" ON "email_outbox" USING btree ("kind","waitlist_entry_id") WHERE "email_outbox"."waitlist_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "email_outbox_reservation_id_idx" ON "email_outbox" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "email_outbox_waitlist_entry_id_idx" ON "email_outbox" USING btree ("waitlist_entry_id");--> statement-breakpoint
CREATE INDEX "email_outbox_admin_user_id_idx" ON "email_outbox" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_waitlist_entry_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_waitlist_capacity_chk" CHECK ("events"."waitlist_capacity" BETWEEN 0 AND 50);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_waitlisted_within_capacity_chk" CHECK ("events"."waitlisted_count" >= 0 AND "events"."waitlisted_count" <= "events"."waitlist_capacity");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_waitlist_number_nonnegative_chk" CHECK ("events"."last_waitlist_number" >= 0);--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_single_subject_chk" CHECK ("idempotency_records"."reservation_id" IS NULL OR "idempotency_records"."waitlist_entry_id" IS NULL);--> statement-breakpoint
-- The production app role needs the new workflow tables without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE ON waitlist_entries, admin_password_reset_tokens TO clandestino_app; GRANT SELECT, INSERT, UPDATE, DELETE ON email_outbox TO clandestino_app; END IF; END $$;
