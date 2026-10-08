ALTER TABLE "reservations" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_allergies_length_chk" CHECK ("reservations"."allergies" IS NULL OR char_length("reservations"."allergies") BETWEEN 1 AND 300);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_allergies_length_chk" CHECK ("waitlist_entries"."allergies" IS NULL OR char_length("waitlist_entries"."allergies") BETWEEN 1 AND 300);
