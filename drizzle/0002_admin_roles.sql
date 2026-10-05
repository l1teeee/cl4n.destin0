CREATE TYPE "public"."admin_role" AS ENUM('SUPER_ADMIN', 'ADMIN');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_CREATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_DEACTIVATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_USER_REACTIVATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_PASSWORD_RESET';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_PASSWORD_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ADMIN_SESSIONS_REVOKED';--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "role" "admin_role" DEFAULT 'ADMIN' NOT NULL;--> statement-breakpoint
UPDATE "admin_users" SET "role" = 'SUPER_ADMIN';
