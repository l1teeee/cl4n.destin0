DROP INDEX "messages_location_revision_uq";--> statement-breakpoint
DROP INDEX "messages_clue_uq";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "guest_slot" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "guest2_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_contact_fk" FOREIGN KEY ("guest2_contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_guest2_contact_idx" ON "reservations" USING btree ("guest2_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_location_revision_uq" ON "messages" USING btree ("reservation_id","guest_slot","location_revision") WHERE "messages"."kind" = 'LOCATION';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_clue_uq" ON "messages" USING btree ("reservation_id","guest_slot","clue_id") WHERE "messages"."kind" = 'CLUE';--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_guest_slot_chk" CHECK ("messages"."guest_slot" IN (1, 2));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_guest_slot_subject_chk" CHECK ("messages"."guest_slot" = 1 OR "messages"."reservation_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_contact_requires_guest2_chk" CHECK ("reservations"."guest2_contact_id" IS NULL OR "reservations"."guest2_full_name" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest2_contact_distinct_chk" CHECK ("reservations"."guest2_contact_id" IS NULL OR "reservations"."guest2_contact_id" IS DISTINCT FROM "reservations"."contact_id");