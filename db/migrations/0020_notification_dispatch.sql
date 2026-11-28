-- NF-REL-005 partiel : prise et reprise seulement, aucun acquittement de livraison.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_worker') THEN
    CREATE ROLE notification_worker NOLOGIN;
  END IF;
END $$;
CREATE TABLE notifications.dispatch_policy (
  id integer PRIMARY KEY CHECK (id = 1),
  lease_ms integer NOT NULL CHECK (lease_ms BETWEEN 1 AND 86400000),
  retry_ms integer NOT NULL CHECK (retry_ms BETWEEN 1 AND 86400000),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 1000)
);
CREATE TABLE notifications.dispatch_state (
  recipient_id uuid NOT NULL,
  event_key uuid NOT NULL,
  channel text NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 1000),
  attempt_limit integer NOT NULL CHECK (attempt_limit BETWEEN 1 AND 1000 AND attempt <= attempt_limit),
  claim_id uuid UNIQUE,
  lease_until timestamptz,
  available_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_id, event_key, channel),
  FOREIGN KEY (recipient_id, event_key, channel) REFERENCES notifications.outbox,
  CHECK ((claim_id IS NULL) = (lease_until IS NULL))
);
CREATE FUNCTION notifications.claim_notification()
RETURNS TABLE (recipient_id uuid, event_key uuid, channel text, event_type text, locale text,
  claim_id uuid, attempt integer, lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  policy notifications.dispatch_policy%ROWTYPE;
  candidate notifications.outbox%ROWTYPE;
  state notifications.dispatch_state%ROWTYPE;
  instant timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  SELECT * INTO policy FROM notifications.dispatch_policy WHERE id = 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: politique de consommation absente'; END IF;
  instant := clock_timestamp();
  SELECT o.* INTO candidate FROM notifications.outbox o
    LEFT JOIN notifications.dispatch_state s USING (recipient_id, event_key, channel)
    WHERE o.event_type IN ('PAYMENT_CONFIRMED','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED')
      AND (s.attempt IS NULL OR (s.attempt < s.attempt_limit AND coalesce(s.lease_until, s.available_at) <= instant))
    ORDER BY o.created_at, o.recipient_id, o.event_key, o.channel
    LIMIT 1 FOR UPDATE OF o SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  -- Relire après verrouillage : le JOIN initial pouvait voir un état antérieur.
  SELECT * INTO state FROM notifications.dispatch_state s
    WHERE s.recipient_id = candidate.recipient_id AND s.event_key = candidate.event_key AND s.channel = candidate.channel FOR UPDATE;
  instant := clock_timestamp();
  IF FOUND AND (state.attempt >= state.attempt_limit OR coalesce(state.lease_until, state.available_at) > instant) THEN RETURN; END IF;
  INSERT INTO notifications.dispatch_state AS s
    (recipient_id, event_key, channel, attempt, attempt_limit, claim_id, lease_until, available_at)
    VALUES (candidate.recipient_id, candidate.event_key, candidate.channel, 1, policy.max_attempts,
      gen_random_uuid(), instant + policy.lease_ms * interval '1 millisecond', instant)
    ON CONFLICT ON CONSTRAINT dispatch_state_pkey DO UPDATE
      SET attempt = s.attempt + 1, claim_id = gen_random_uuid(),
        lease_until = instant + policy.lease_ms * interval '1 millisecond', available_at = instant
    RETURNING * INTO state;
  RETURN QUERY SELECT candidate.recipient_id, candidate.event_key, candidate.channel, candidate.event_type,
    candidate.locale, state.claim_id, state.attempt, state.lease_until;
END $$;
CREATE FUNCTION notifications.retry_notification(p_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  policy notifications.dispatch_policy%ROWTYPE;
  candidate notifications.outbox%ROWTYPE;
  state notifications.dispatch_state%ROWTYPE;
  instant timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  SELECT * INTO policy FROM notifications.dispatch_policy WHERE id = 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: politique de consommation absente'; END IF;
  -- Même ordre de verrous que la prise : enveloppe, puis état.
  SELECT o.* INTO candidate FROM notifications.outbox o JOIN notifications.dispatch_state s USING (recipient_id, event_key, channel)
    WHERE s.claim_id = p_claim FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_CLAIM_LOST: bail absent ou expiré'; END IF;
  SELECT * INTO state FROM notifications.dispatch_state s
    WHERE s.recipient_id = candidate.recipient_id AND s.event_key = candidate.event_key AND s.channel = candidate.channel FOR UPDATE;
  instant := clock_timestamp();
  IF state.claim_id IS DISTINCT FROM p_claim OR state.lease_until IS NULL OR state.lease_until <= instant THEN
    RAISE EXCEPTION 'NOTIFICATION_CLAIM_LOST: bail absent ou expiré';
  END IF;
  UPDATE notifications.dispatch_state s SET claim_id = NULL, lease_until = NULL,
      available_at = instant + policy.retry_ms * interval '1 millisecond'
    WHERE s.recipient_id = candidate.recipient_id AND s.event_key = candidate.event_key AND s.channel = candidate.channel;
END $$;
CREATE FUNCTION notifications.dispatch_counts()
RETURNS TABLE (pending bigint, leased bigint, retry_wait bigint, exhausted bigint, deferred_reminders bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM notifications.dispatch_policy WHERE id = 1) THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: politique de consommation absente';
  END IF;
  RETURN QUERY WITH classified AS (
    SELECT CASE
      WHEN o.event_type = 'PAYMENT_REMINDER' THEN 'deferred'
      WHEN o.event_type IN ('PAYMENT_CONFIRMED','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED') THEN
        CASE WHEN s.attempt IS NULL THEN 'pending'
          WHEN s.lease_until > statement_timestamp() THEN 'leased'
          WHEN s.attempt >= s.attempt_limit THEN 'exhausted'
          WHEN s.available_at > statement_timestamp() THEN 'retry_wait'
          ELSE 'pending' END
      ELSE 'deferred' END AS category
    FROM notifications.outbox o LEFT JOIN notifications.dispatch_state s USING (recipient_id, event_key, channel)
  ) SELECT count(*) FILTER (WHERE category = 'pending'), count(*) FILTER (WHERE category = 'leased'),
    count(*) FILTER (WHERE category = 'retry_wait'), count(*) FILTER (WHERE category = 'exhausted'),
    count(*) FILTER (WHERE category = 'deferred') FROM classified;
END $$;
REVOKE ALL ON TABLE notifications.dispatch_policy, notifications.dispatch_state FROM PUBLIC, app_rw, app_ro, notification_worker;
REVOKE ALL ON TABLE notifications.outbox, notifications.reminder_policy, notifications.reminder_reservation FROM notification_worker;
REVOKE ALL ON FUNCTION notifications.claim_notification(), notifications.retry_notification(uuid), notifications.dispatch_counts() FROM PUBLIC, app_rw, app_ro;
GRANT USAGE ON SCHEMA notifications TO notification_worker;
GRANT EXECUTE ON FUNCTION notifications.claim_notification(), notifications.retry_notification(uuid), notifications.dispatch_counts() TO notification_worker;
COMMIT;
