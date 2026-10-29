ALTER TYPE "public"."audit_action" ADD VALUE 'DRINK_CREATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'DRINK_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'DRINK_DELETED';--> statement-breakpoint
CREATE TABLE "drink_images" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"drink_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "drink_images_pkey" PRIMARY KEY("id"),
	CONSTRAINT "drink_images_drink_uq" UNIQUE("drink_id"),
	CONSTRAINT "drink_images_content_type_chk" CHECK ("drink_images"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "drink_images_byte_size_chk" CHECK ("drink_images"."byte_size" BETWEEN 1 AND 2097152),
	CONSTRAINT "drink_images_data_size_chk" CHECK (octet_length("drink_images"."data") = "drink_images"."byte_size")
);
--> statement-breakpoint
CREATE TABLE "drinks" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "drinks_pkey" PRIMARY KEY("id"),
	CONSTRAINT "drinks_name_length_chk" CHECK (char_length("drinks"."name") BETWEEN 1 AND 80),
	CONSTRAINT "drinks_description_length_chk" CHECK ("drinks"."description" IS NULL OR char_length("drinks"."description") BETWEEN 1 AND 280),
	CONSTRAINT "drinks_price_cents_chk" CHECK ("drinks"."price_cents" BETWEEN 1 AND 999999)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_entity_type_chk";--> statement-breakpoint
ALTER TABLE "drink_images" ADD CONSTRAINT "drink_images_drink_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drink_images" ADD CONSTRAINT "drink_images_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_chk" CHECK ("audit_logs"."entity_type" IN ('EVENT', 'RESERVATION', 'ADMIN_USER', 'WAITLIST_ENTRY', 'DRINK'));--> statement-breakpoint
-- The production app role needs the drinks menu without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON drinks TO clandestino_app; GRANT SELECT, INSERT, DELETE ON drink_images TO clandestino_app; END IF; END $$;
