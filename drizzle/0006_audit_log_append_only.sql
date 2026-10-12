-- The audit log is append-only (audit SEC-010): rows can be added, never changed or removed, by the
-- tool, the scripts or a reset. Only a database administrator dropping this trigger could.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
