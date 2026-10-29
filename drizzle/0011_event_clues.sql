CREATE TABLE "event_clues" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "event_clues_pkey" PRIMARY KEY("id"),
	CONSTRAINT "event_clues_body_length_chk" CHECK (char_length("event_clues"."body") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "event_clues" ADD CONSTRAINT "event_clues_event_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_clues" ADD CONSTRAINT "event_clues_created_by_admin_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_clues_event_created_at_idx" ON "event_clues" USING btree ("event_id","created_at");--> statement-breakpoint
-- The production app role needs event clues without broader database privileges.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, DELETE ON event_clues TO clandestino_app; END IF; END $$;
