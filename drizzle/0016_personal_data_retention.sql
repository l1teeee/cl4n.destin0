ALTER TABLE "events" ADD COLUMN "personal_data_purged_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "events_personal_data_retention_idx" ON "events" ("starts_at", "id") WHERE "personal_data_purged_at" IS NULL;
