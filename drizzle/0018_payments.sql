ALTER TYPE "public"."audit_action" ADD VALUE 'PAYMENT_SETTINGS_UPDATED';--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"bank_name" text NOT NULL,
	"account_type" text NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"payment_link" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "payment_settings_singleton" CHECK ("payment_settings"."id" = 1),
	CONSTRAINT "payment_settings_bank_name_length_chk" CHECK (char_length("payment_settings"."bank_name") BETWEEN 1 AND 80),
	CONSTRAINT "payment_settings_account_type_chk" CHECK ("payment_settings"."account_type" IN ('Ahorro', 'Corriente')),
	CONSTRAINT "payment_settings_account_number_length_chk" CHECK (char_length("payment_settings"."account_number") BETWEEN 1 AND 80),
	CONSTRAINT "payment_settings_account_holder_length_chk" CHECK (char_length("payment_settings"."account_holder") BETWEEN 1 AND 80),
	CONSTRAINT "payment_settings_payment_link_chk" CHECK ("payment_settings"."payment_link" IS NULL OR (char_length("payment_settings"."payment_link") BETWEEN 1 AND 300 AND ("payment_settings"."payment_link" !~* '^http' OR "payment_settings"."payment_link" ~* '^https://')))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_updated_by_admin_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK', 'MESSAGE_TEMPLATE', 'MESSAGING_CONTACT', 'INSTAGRAM_CONNECTION', 'EXTRA', 'GUEST_CONSUMPTION', 'GUEST_TAB', 'PAYMENT_SETTINGS'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_price_cents_chk" CHECK ("events"."price_cents" IS NULL OR "events"."price_cents" >= 0);--> statement-breakpoint
-- Only a template still holding the seeded text moves to the split payment variables; an edited one is kept.
UPDATE "message_templates"
   SET "body" = E'¡Felicidades, {nombre}, estás en la lista! Para asegurar tu lugar tienes 48 horas para transferir {monto}.\n\nBanco: {banco}\nTipo de cuenta: {tipo_cuenta}\nCuenta: {cuenta}\nTitular: {titular}\n{enlace_pago}\n{nota_pago}\n\nCuando transfieras, envíanos el comprobante por aquí.',
       "updated_at" = now()
 WHERE "key" = 'ON_LIST'
   AND "body" = E'¡Felicidades, {nombre}, estás en la lista! Ahora tienes 48 horas para cancelar por transferencia y asegurar tu lugar.\n\n{pago}\n\nCuando transfieras, envíanos el comprobante por aquí.';--> statement-breakpoint
-- The production app role needs the payment settings without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE ON payment_settings TO clandestino_app; END IF; END $$;
