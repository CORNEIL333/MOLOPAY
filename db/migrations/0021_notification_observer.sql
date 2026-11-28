-- NF-REL-005 : diagnostic agrégé sans lecture de destinataire ni mutation.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_observer') THEN
    CREATE ROLE notification_observer NOLOGIN;
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA notifications FROM notification_observer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA notifications FROM notification_observer;
GRANT USAGE ON SCHEMA notifications TO notification_observer;
GRANT EXECUTE ON FUNCTION notifications.dispatch_counts() TO notification_observer;
COMMIT;
