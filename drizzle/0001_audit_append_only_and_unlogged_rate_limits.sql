ALTER TABLE "rate_limit_counters" SET UNLOGGED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_logs_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
		USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only_row"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "audit_logs_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only_truncate"
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT
EXECUTE FUNCTION "audit_logs_reject_mutation"();
