ALTER TYPE "public"."audit_action" ADD VALUE 'INSTAGRAM_CONNECTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'INSTAGRAM_DISCONNECTED';--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK', 'MESSAGE_TEMPLATE', 'MESSAGING_CONTACT', 'INSTAGRAM_CONNECTION'));--> statement-breakpoint
CREATE TABLE "instagram_connection" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "account_id" text NOT NULL,
  "username" text NOT NULL,
  "access_token_ciphertext" text NOT NULL,
  "token_expires_at" timestamp with time zone NOT NULL,
  "token_version" integer DEFAULT 1 NOT NULL,
  "connected_by_admin_id" uuid,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "token_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_connection_singleton" CHECK ("id" = 1),
  CONSTRAINT "instagram_connection_account_id_digits" CHECK ("account_id" ~ '^[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "instagram_connection" ADD CONSTRAINT "instagram_connection_connected_by_admin_fk" FOREIGN KEY ("connected_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_connection TO clandestino_app; END IF; END $$;
