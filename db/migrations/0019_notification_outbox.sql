-- Enveloppes de notifications : aucun texte, numéro ou jeton de destination.
BEGIN;
CREATE TABLE notifications.outbox (
  recipient_id uuid NOT NULL,
  event_key uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'PUSH')),
  event_type text NOT NULL CHECK (event_type IN ('PAYMENT_CONFIRMED','PAYMENT_REMINDER','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED')),
  locale text NOT NULL CHECK (locale IN ('fr','en')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_id, event_key, channel)
);
CREATE FUNCTION notifications.enqueue_notification(p_recipient uuid, p_key uuid, p_event text, p_locale text, p_channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous notifications.outbox%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  IF p_recipient IS NULL OR p_key IS NULL OR p_event IS NULL OR p_locale IS NULL OR p_channel IS NULL
    OR p_event NOT IN ('PAYMENT_CONFIRMED','PAYMENT_REMINDER','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED')
    OR p_locale NOT IN ('fr','en') OR p_channel NOT IN ('SMS','PUSH') THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: enveloppe invalide';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipient::text || ':' || p_key::text || ':' || p_channel, 17004));
  SELECT * INTO previous FROM notifications.outbox
    WHERE recipient_id = p_recipient AND event_key = p_key AND channel = p_channel;
  IF FOUND THEN
    IF previous.event_type <> p_event OR previous.locale <> p_locale THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: enveloppe différente';
    END IF;
    RETURN true;
  END IF;
  INSERT INTO notifications.outbox VALUES (p_recipient, p_key, p_channel, p_event, p_locale, clock_timestamp());
  RETURN false;
END $$;
REVOKE ALL ON TABLE notifications.outbox FROM PUBLIC, app_rw, app_ro;
REVOKE ALL ON FUNCTION notifications.enqueue_notification(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.enqueue_notification(uuid,uuid,text,text,text) TO app_rw;
COMMIT;
