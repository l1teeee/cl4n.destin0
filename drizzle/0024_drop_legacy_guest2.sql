INSERT INTO request_guests (reservation_id, slot, full_name, instagram_handle, contact_id) SELECT id, 2, guest2_full_name, guest2_instagram_handle, guest2_contact_id FROM reservations WHERE guest2_full_name IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO request_guests (waitlist_entry_id, slot, full_name, instagram_handle) SELECT id, 2, guest2_full_name, guest2_instagram_handle FROM waitlist_entries WHERE guest2_full_name IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_guest2_pair_chk";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_guest2_instagram_chk";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_guest2_contact_requires_guest2_chk";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_guest2_contact_distinct_chk";--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP CONSTRAINT "waitlist_entries_guest2_pair_chk";--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP CONSTRAINT "waitlist_entries_guest2_instagram_chk";--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_guest2_contact_fk";
--> statement-breakpoint
DROP INDEX "reservations_guest2_contact_idx";--> statement-breakpoint
ALTER TABLE "reservations" DROP COLUMN "guest2_full_name";--> statement-breakpoint
ALTER TABLE "reservations" DROP COLUMN "guest2_instagram_handle";--> statement-breakpoint
ALTER TABLE "reservations" DROP COLUMN "guest2_contact_id";--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP COLUMN "guest2_full_name";--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP COLUMN "guest2_instagram_handle";