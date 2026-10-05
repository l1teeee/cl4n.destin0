CREATE TYPE "public"."actor_type" AS ENUM('ADMIN', 'PUBLIC', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_OPENED', 'EVENT_CLOSED', 'CAPACITY_CHANGED', 'RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'ADMIN_SIGNED_IN');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('DRAFT', 'SCHEDULED', 'CLOSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('SUBMITTED', 'CONFIRMED', 'FULL_REJECTED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_sessions_pkey" PRIMARY KEY("id"),
	CONSTRAINT "admin_sessions_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	CONSTRAINT "admin_users_pkey" PRIMARY KEY("id"),
	CONSTRAINT "admin_users_email_normalized_uq" UNIQUE("email_normalized")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_admin_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_logs_pkey" PRIMARY KEY("id"),
	CONSTRAINT "audit_logs_admin_actor_chk" CHECK (("audit_logs"."actor_type" = 'ADMIN') = ("audit_logs"."actor_admin_id" IS NOT NULL)),
	CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"internal_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"reserved_seats" integer DEFAULT 0 NOT NULL,
	"max_party_size" integer NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"auto_close_on_full" boolean DEFAULT false NOT NULL,
	"status" "event_status" DEFAULT 'DRAFT' NOT NULL,
	"last_reservation_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_pkey" PRIMARY KEY("id"),
	CONSTRAINT "events_slug_uq" UNIQUE("slug"),
	CONSTRAINT "events_slug_format_chk" CHECK ("events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "events_slug_length_chk" CHECK (char_length("events"."slug") <= 80),
	CONSTRAINT "events_internal_name_length_chk" CHECK (char_length("events"."internal_name") BETWEEN 1 AND 120),
	CONSTRAINT "events_capacity_positive_chk" CHECK ("events"."capacity" > 0),
	CONSTRAINT "events_reserved_within_capacity_chk" CHECK ("events"."reserved_seats" >= 0 AND "events"."reserved_seats" <= "events"."capacity"),
	CONSTRAINT "events_max_party_within_capacity_chk" CHECK ("events"."max_party_size" >= 1 AND "events"."max_party_size" <= "events"."capacity"),
	CONSTRAINT "events_window_order_chk" CHECK ("events"."closes_at" > "events"."opens_at"),
	CONSTRAINT "events_reservation_number_nonnegative_chk" CHECK ("events"."last_reservation_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"key" uuid NOT NULL,
	"scope" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_pkey" PRIMARY KEY("key"),
	CONSTRAINT "idempotency_records_completion_chk" CHECK (("idempotency_records"."completed_at" IS NULL) = ("idempotency_records"."response_status" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"reservation_number" integer,
	"status" "reservation_status" NOT NULL,
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
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_pkey" PRIMARY KEY("id"),
	CONSTRAINT "reservations_event_number_uq" UNIQUE("event_id","reservation_number"),
	CONSTRAINT "reservations_idempotency_key_uq" UNIQUE("idempotency_key"),
	CONSTRAINT "reservations_full_name_length_chk" CHECK (char_length("reservations"."full_name") BETWEEN 1 AND 120),
	CONSTRAINT "reservations_party_size_positive_chk" CHECK ("reservations"."party_size" >= 1),
	CONSTRAINT "reservations_notes_length_chk" CHECK ("reservations"."notes" IS NULL OR char_length("reservations"."notes") <= 500),
	CONSTRAINT "reservations_confirmed_fields_chk" CHECK ("reservations"."status" <> 'CONFIRMED' OR ("reservations"."reservation_number" IS NOT NULL AND "reservations"."accepted_at" IS NOT NULL)),
	CONSTRAINT "reservations_full_rejected_fields_chk" CHECK ("reservations"."status" <> 'FULL_REJECTED' OR ("reservations"."reservation_number" IS NULL AND "reservations"."accepted_at" IS NULL)),
	CONSTRAINT "reservations_cancelled_timestamp_chk" CHECK ("reservations"."status" <> 'CANCELLED' OR "reservations"."cancelled_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_admin_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_occurred_at_idx" ON "audit_logs" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_status_opens_at_idx" ON "events" USING btree ("status","opens_at");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_start_idx" ON "rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_confirmed_per_email_uq" ON "reservations" USING btree ("event_id","email_normalized") WHERE "reservations"."status" = 'CONFIRMED';--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_confirmed_per_phone_uq" ON "reservations" USING btree ("event_id","phone_e164") WHERE "reservations"."status" = 'CONFIRMED';--> statement-breakpoint
CREATE INDEX "reservations_event_status_idx" ON "reservations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "reservations_event_submitted_at_idx" ON "reservations" USING btree ("event_id","submitted_at");