ALTER TYPE "public"."audit_action" ADD VALUE 'EXTRA_CREATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'EXTRA_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'EXTRA_DELETED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'CONSUMPTION_ADDED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'CONSUMPTION_VOIDED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'GUEST_TAB_SETTLED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'GUEST_TAB_REOPENED';--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "extras_pkey" PRIMARY KEY("id"),
	CONSTRAINT "extras_name_length_chk" CHECK (char_length("extras"."name") BETWEEN 1 AND 80),
	CONSTRAINT "extras_price_cents_chk" CHECK ("extras"."price_cents" BETWEEN 0 AND 10000000)
);
--> statement-breakpoint
CREATE TABLE "guest_consumptions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"guest_slot" smallint NOT NULL,
	"source" text NOT NULL,
	"drink_id" uuid,
	"extra_id" uuid,
	"item_name" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	CONSTRAINT "guest_consumptions_pkey" PRIMARY KEY("id"),
	CONSTRAINT "guest_consumptions_guest_slot_chk" CHECK ("guest_consumptions"."guest_slot" IN (1, 2)),
	CONSTRAINT "guest_consumptions_source_chk" CHECK ("guest_consumptions"."source" IN ('DRINK', 'EXTRA', 'CUSTOM')),
	CONSTRAINT "guest_consumptions_source_reference_chk" CHECK (("guest_consumptions"."drink_id" IS NULL OR "guest_consumptions"."source" = 'DRINK') AND ("guest_consumptions"."extra_id" IS NULL OR "guest_consumptions"."source" = 'EXTRA')),
	CONSTRAINT "guest_consumptions_item_name_length_chk" CHECK (char_length("guest_consumptions"."item_name") BETWEEN 1 AND 80),
	CONSTRAINT "guest_consumptions_unit_price_chk" CHECK ("guest_consumptions"."unit_price_cents" BETWEEN 0 AND 10000000),
	CONSTRAINT "guest_consumptions_quantity_chk" CHECK ("guest_consumptions"."quantity" BETWEEN 1 AND 99),
	CONSTRAINT "guest_consumptions_voided_pair_chk" CHECK ("guest_consumptions"."voided_at" IS NOT NULL OR "guest_consumptions"."voided_by" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "guest_tabs" (
	"reservation_id" uuid NOT NULL,
	"guest_slot" smallint NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_tabs_pkey" PRIMARY KEY("reservation_id","guest_slot"),
	CONSTRAINT "guest_tabs_guest_slot_chk" CHECK ("guest_tabs"."guest_slot" IN (1, 2))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_drink_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_extra_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_voided_by_admin_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_settled_by_admin_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_consumptions_tab_idx" ON "guest_consumptions" USING btree ("event_id","reservation_id","guest_slot") WHERE "guest_consumptions"."voided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK', 'MESSAGE_TEMPLATE', 'MESSAGING_CONTACT', 'INSTAGRAM_CONNECTION', 'EXTRA', 'GUEST_CONSUMPTION', 'GUEST_TAB'));--> statement-breakpoint
-- The production app role needs the extras catalog and guest tabs without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE ON extras TO clandestino_app; GRANT SELECT, INSERT, UPDATE ON guest_consumptions TO clandestino_app; GRANT SELECT, INSERT, UPDATE ON guest_tabs TO clandestino_app; END IF; END $$;
