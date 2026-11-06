-- F-NOT-003 : réservation conservatrice des rappels, sans envoi ni contenu.
BEGIN;
CREATE SCHEMA notifications;
REVOKE ALL ON SCHEMA notifications FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN CREATE ROLE app_ro NOLOGIN; END IF;
END $$;

-- Configuration explicite par l'opérateur habilité ; aucune valeur par défaut.
CREATE TABLE notifications.reminder_policy (
  id integer PRIMARY KEY CHECK (id = 1),
  time_zone text NOT NULL,
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1439 AND end_minute <> start_minute),
  max_count integer NOT NULL CHECK (max_count > 0),
  window_ms bigint NOT NULL CHECK (window_ms BETWEEN 1 AND 9007199254740991)
);
CREATE TABLE notifications.reminder_reservation (
  recipient_id uuid NOT NULL,
  reservation_key uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'PUSH')),
  reserved_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_id, reservation_key)
);
CREATE INDEX reminder_history ON notifications.reminder_reservation (recipient_id, reserved_at);

CREATE FUNCTION notifications.reserve_reminder(p_recipient uuid, p_key uuid, p_channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  policy notifications.reminder_policy%ROWTYPE;
  previous notifications.reminder_reservation%ROWTYPE;
  instant timestamptz;
  local_minute integer;
  used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  IF p_recipient IS NULL OR p_key IS NULL OR p_channel IS NULL OR p_channel NOT IN ('SMS', 'PUSH') THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: paramètres invalides';
  END IF;
  -- Verrou conservé jusqu'au commit : les canaux partagent le même quota.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipient::text, 17003));
  SELECT * INTO previous FROM notifications.reminder_reservation
    WHERE recipient_id = p_recipient AND reservation_key = p_key;
  IF FOUND THEN
    IF previous.channel <> p_channel THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: canal différent'; END IF;
    RETURN true;
  END IF;
  SELECT * INTO policy FROM notifications.reminder_policy WHERE id = 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: politique absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = policy.time_zone) THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: fuseau invalide';
  END IF;
  instant := clock_timestamp();
  local_minute := extract(hour FROM instant AT TIME ZONE policy.time_zone)::integer * 60
    + extract(minute FROM instant AT TIME ZONE policy.time_zone)::integer;
  IF NOT (CASE WHEN policy.start_minute < policy.end_minute
      THEN local_minute >= policy.start_minute AND local_minute < policy.end_minute
      ELSE local_minute >= policy.start_minute OR local_minute < policy.end_minute END) THEN
    RAISE EXCEPTION 'NOTIFICATION_OUTSIDE_WINDOW: rappel hors plage';
  END IF;
  SELECT count(*) INTO used FROM notifications.reminder_reservation
    WHERE recipient_id = p_recipient
      AND (extract(epoch FROM instant) - extract(epoch FROM reserved_at)) * 1000 < policy.window_ms;
  IF used >= policy.max_count THEN
    RAISE EXCEPTION 'NOTIFICATION_RATE_LIMITED: fréquence maximale atteinte';
  END IF;
  INSERT INTO notifications.reminder_reservation VALUES (p_recipient, p_key, p_channel, instant);
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION notifications.reserve_reminder(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA notifications FROM PUBLIC, app_rw, app_ro;
GRANT USAGE ON SCHEMA notifications TO app_rw;
GRANT EXECUTE ON FUNCTION notifications.reserve_reminder(uuid, uuid, text) TO app_rw;
COMMIT;
