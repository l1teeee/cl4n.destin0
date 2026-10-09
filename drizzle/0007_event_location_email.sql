ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_chk";
--> statement-breakpoint
DROP INDEX "email_outbox_reservation_kind_uq";
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "location_revision" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_location_revision_uq" ON "email_outbox" USING btree ("reservation_id","location_revision") WHERE "email_outbox"."kind" = 'EVENT_LOCATION';
--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_reservation_kind_uq" ON "email_outbox" USING btree ("kind","reservation_id") WHERE "email_outbox"."reservation_id" IS NOT NULL AND "email_outbox"."kind" <> 'EVENT_LOCATION';
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_location_revision_chk" CHECK (("email_outbox"."kind" = 'EVENT_LOCATION') = ("email_outbox"."location_revision" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_chk" CHECK ("email_outbox"."kind" IN ('RESERVATION_CONFIRMED', 'RESERVATION_WAITLISTED', 'WAITLIST_PROMOTED', 'RESERVATION_CANCELLED', 'WAITLIST_CANCELLED', 'EVENT_LOCATION', 'ADMIN_ADDED', 'ADMIN_SIGNED_IN', 'ADMIN_PASSWORD_RESET_BY_ADMIN', 'ADMIN_PASSWORD_CHANGED', 'ADMIN_PASSWORD_RESET_COMPLETED', 'ADMIN_DEACTIVATED', 'ADMIN_REACTIVATED', 'ADMIN_ROLE_CHANGED', 'ADMIN_DELETED', 'ADMIN_SESSIONS_REVOKED'));
