ALTER TYPE "public"."audit_action" ADD VALUE 'MESSAGING_CONTACT_UNLINKED';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "parts_sent" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_part_ids" text[];--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
UPDATE "messages" SET "received_at" = "created_at";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "received_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "received_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "contact_linked_by" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "contact_linked_by" text;--> statement-breakpoint
UPDATE "waitlist_entries" SET "contact_linked_by" = 'CODE' WHERE "contact_id" IS NOT NULL;--> statement-breakpoint
UPDATE "reservations" SET "contact_linked_by" = 'CODE' WHERE "contact_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_parts_sent_chk" CHECK ("messages"."parts_sent" >= 0);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_external_part_ids_chk" CHECK ("messages"."external_part_ids" IS NULL OR cardinality("messages"."external_part_ids") BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contact_linked_by_chk" CHECK ("reservations"."contact_linked_by" IS NULL OR "reservations"."contact_linked_by" IN ('CODE', 'USERNAME', 'MANUAL'));--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contact_link_pair_chk" CHECK (("reservations"."contact_id" IS NULL) = ("reservations"."contact_linked_by" IS NULL));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_contact_linked_by_chk" CHECK ("waitlist_entries"."contact_linked_by" IS NULL OR "waitlist_entries"."contact_linked_by" IN ('CODE', 'USERNAME', 'MANUAL'));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_contact_link_pair_chk" CHECK (("waitlist_entries"."contact_id" IS NULL) = ("waitlist_entries"."contact_linked_by" IS NULL));
