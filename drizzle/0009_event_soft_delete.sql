ALTER TYPE "public"."audit_action" ADD VALUE 'EVENT_DELETED';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_slug_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_live_uq" ON "events" USING btree ("slug") WHERE "events"."deleted_at" IS NULL;
