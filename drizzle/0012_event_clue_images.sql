CREATE TABLE "event_clue_images" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"clue_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_clue_images_pkey" PRIMARY KEY("id"),
	CONSTRAINT "event_clue_images_clue_position_uq" UNIQUE("clue_id", "position"),
	CONSTRAINT "event_clue_images_position_chk" CHECK ("event_clue_images"."position" BETWEEN 0 AND 2),
	CONSTRAINT "event_clue_images_content_type_chk" CHECK ("event_clue_images"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "event_clue_images_byte_size_chk" CHECK ("event_clue_images"."byte_size" BETWEEN 1 AND 1048576),
	CONSTRAINT "event_clue_images_data_size_chk" CHECK (octet_length("event_clue_images"."data") = "event_clue_images"."byte_size")
);
--> statement-breakpoint
ALTER TABLE "event_clue_images" ADD CONSTRAINT "event_clue_images_clue_fk" FOREIGN KEY ("clue_id") REFERENCES "public"."event_clues"("id") ON DELETE cascade ON UPDATE no action;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT ON event_clue_images TO clandestino_app; END IF; END $$;
