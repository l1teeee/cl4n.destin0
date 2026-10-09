CREATE TYPE "public"."event_location_status" AS ENUM('PENDING', 'CONFIRMED');--> statement-breakpoint
CREATE TABLE "event_images" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"public_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "event_images_pkey" PRIMARY KEY("id"),
	CONSTRAINT "event_images_public_token_uq" UNIQUE("public_token"),
	CONSTRAINT "event_images_content_type_chk" CHECK ("event_images"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "event_images_byte_size_chk" CHECK ("event_images"."byte_size" BETWEEN 1 AND 2097152),
	CONSTRAINT "event_images_data_size_chk" CHECK (octet_length("event_images"."data") = "event_images"."byte_size"),
	CONSTRAINT "event_images_public_token_length_chk" CHECK (char_length("event_images"."public_token") = 43)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_address" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_maps_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_notes" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_status" "event_location_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_images_event_created_at_idx" ON "event_images" USING btree ("event_id","created_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_name_length_chk" CHECK ("events"."location_name" IS NULL OR char_length("events"."location_name") BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_address_length_chk" CHECK ("events"."location_address" IS NULL OR char_length("events"."location_address") BETWEEN 1 AND 300);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_maps_url_chk" CHECK ("events"."location_maps_url" IS NULL OR (char_length("events"."location_maps_url") BETWEEN 1 AND 2048 AND "events"."location_maps_url" LIKE 'https://%'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_notes_length_chk" CHECK ("events"."location_notes" IS NULL OR char_length("events"."location_notes") BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_confirmation_timestamp_chk" CHECK (("events"."location_status" = 'CONFIRMED') = ("events"."location_confirmed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_confirmation_complete_chk" CHECK ("events"."location_status" <> 'CONFIRMED' OR "events"."location_address" IS NOT NULL OR "events"."location_maps_url" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_revision_nonnegative_chk" CHECK ("events"."location_revision" >= 0);--> statement-breakpoint
-- The production app role needs event images without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, DELETE ON event_images TO clandestino_app; END IF; END $$;
