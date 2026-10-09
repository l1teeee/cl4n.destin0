ALTER TABLE "events" ADD COLUMN "location_released_revision" integer;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_latitude" double precision;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_longitude" double precision;
--> statement-breakpoint
UPDATE events e
   SET location_released_revision = e.location_revision
 WHERE e.location_status = 'CONFIRMED'
   AND EXISTS (
     SELECT 1
       FROM email_outbox o
       JOIN reservations r ON r.id = o.reservation_id
      WHERE r.event_id = e.id
        AND o.kind = 'EVENT_LOCATION'
        AND o.location_revision = e.location_revision
   );
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_released_revision_chk" CHECK ("events"."location_released_revision" IS NULL OR ("events"."location_released_revision" >= 0 AND "events"."location_released_revision" <= "events"."location_revision"));
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_coordinates_pair_chk" CHECK (("events"."location_latitude" IS NULL) = ("events"."location_longitude" IS NULL));
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_latitude_chk" CHECK ("events"."location_latitude" IS NULL OR "events"."location_latitude" BETWEEN -90 AND 90);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_longitude_chk" CHECK ("events"."location_longitude" IS NULL OR "events"."location_longitude" BETWEEN -180 AND 180);
