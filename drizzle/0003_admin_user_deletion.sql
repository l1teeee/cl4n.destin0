ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_DELETION_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_DELETED';--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_email_normalized_uq";--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_deleted_inactive_chk" CHECK ("admin_users"."deleted_at" IS NULL OR "admin_users"."is_active" = false);--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_normalized_live_uq" ON "admin_users" USING btree ("email_normalized") WHERE "admin_users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE "admin_action_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"actor_admin_id" uuid NOT NULL,
	"target_admin_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_action_codes_purpose_chk" CHECK ("admin_action_codes"."purpose" IN ('ADMIN_USER_DELETE')),
	CONSTRAINT "admin_action_codes_attempts_chk" CHECK ("admin_action_codes"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "admin_action_codes" ADD CONSTRAINT "admin_action_codes_actor_admin_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_action_codes" ADD CONSTRAINT "admin_action_codes_target_admin_fk" FOREIGN KEY ("target_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_action_codes_live_uq" ON "admin_action_codes" USING btree ("actor_admin_id","target_admin_id","purpose") WHERE "admin_action_codes"."consumed_at" IS NULL AND "admin_action_codes"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_action_codes_target_admin_idx" ON "admin_action_codes" USING btree ("target_admin_id");--> statement-breakpoint
-- The production app uses this least-privilege role, so the new table must be usable immediately after migration.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clandestino_app') THEN GRANT SELECT, INSERT, UPDATE ON admin_action_codes TO clandestino_app; END IF; END $$;
