CREATE TABLE "request_guests" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid,
	"waitlist_entry_id" uuid,
	"slot" smallint NOT NULL,
	"full_name" text NOT NULL,
	"instagram_handle" text NOT NULL,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_guests_pkey" PRIMARY KEY("id"),
	CONSTRAINT "request_guests_reservation_slot_uq" UNIQUE("reservation_id","slot"),
	CONSTRAINT "request_guests_waitlist_entry_slot_uq" UNIQUE("waitlist_entry_id","slot"),
	CONSTRAINT "request_guests_subject_chk" CHECK (num_nonnulls("request_guests"."reservation_id", "request_guests"."waitlist_entry_id") = 1),
	CONSTRAINT "request_guests_slot_chk" CHECK ("request_guests"."slot" >= 2),
	CONSTRAINT "request_guests_full_name_chk" CHECK (char_length("request_guests"."full_name") BETWEEN 1 AND 120),
	CONSTRAINT "request_guests_instagram_chk" CHECK ("request_guests"."instagram_handle" ~ '^[a-z0-9._]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "guest_consumptions" DROP CONSTRAINT "guest_consumptions_guest_slot_chk";--> statement-breakpoint
ALTER TABLE "guest_tabs" DROP CONSTRAINT "guest_tabs_guest_slot_chk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_guest_slot_chk";--> statement-breakpoint
ALTER TABLE "request_guests" ADD CONSTRAINT "request_guests_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_guests" ADD CONSTRAINT "request_guests_waitlist_entry_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_guests" ADD CONSTRAINT "request_guests_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_guests_contact_idx" ON "request_guests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "request_guests_instagram_idx" ON "request_guests" USING btree ("instagram_handle");--> statement-breakpoint
ALTER TABLE "guest_consumptions" ADD CONSTRAINT "guest_consumptions_guest_slot_chk" CHECK ("guest_consumptions"."guest_slot" >= 1);--> statement-breakpoint
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_guest_slot_chk" CHECK ("guest_tabs"."guest_slot" >= 1);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_guest_slot_chk" CHECK ("messages"."guest_slot" >= 1);--> statement-breakpoint
INSERT INTO request_guests (reservation_id, slot, full_name, instagram_handle, contact_id)
SELECT id, 2, guest2_full_name, guest2_instagram_handle, guest2_contact_id
  FROM reservations
 WHERE guest2_full_name IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO request_guests (waitlist_entry_id, slot, full_name, instagram_handle)
SELECT id, 2, guest2_full_name, guest2_instagram_handle
  FROM waitlist_entries
 WHERE guest2_full_name IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON request_guests TO clandestino_app;
  END IF;
END $$;
