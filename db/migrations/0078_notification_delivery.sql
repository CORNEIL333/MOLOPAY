-- Migration 0078 — confirmation d'envoi d'une notification (NF-REL-005,
-- préparation du travailleur de notifications ; aucun envoi ici).
-- Dépend de 0019, 0020, 0021.
--
-- Le travailleur, après l'envoi par le prestataire, confirme avec la
-- référence du message (identifiant opaque, jamais le texte ni le numéro).
-- Une notification confirmée n'est plus jamais reprise : pas de double SMS.
-- Confirmation rejouée avec la même référence : sans effet. Bail repris par un
-- autre travailleur : refus. Même bail expiré mais non repris : accepté, car
-- le message est parti et le refuser provoquerait un second envoi.

BEGIN;

CREATE TABLE notifications.delivery (
  recipient_id uuid NOT NULL,
  event_key uuid NOT NULL,
  channel text NOT NULL,
  claim_id uuid NOT NULL UNIQUE,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 1000),
  provider_ref text NOT NULL CHECK (provider_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  delivered_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_id, event_key, channel),
  FOREIGN KEY (recipient_id, event_key, channel) REFERENCES notifications.outbox
);

CREATE FUNCTION notifications.forbid_delivery_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'NOTIFICATION_APPEND_ONLY: % sur notifications.delivery refusé', TG_OP;
END $fn$;
CREATE TRIGGER delivery_no_update_delete BEFORE UPDATE OR DELETE ON notifications.delivery
  FOR EACH ROW EXECUTE FUNCTION notifications.forbid_delivery_mutation();
CREATE TRIGGER delivery_no_truncate BEFORE TRUNCATE ON notifications.delivery
  FOR EACH STATEMENT EXECUTE FUNCTION notifications.forbid_delivery_mutation();
ALTER TABLE notifications.delivery ENABLE ALWAYS TRIGGER delivery_no_update_delete;
ALTER TABLE notifications.delivery ENABLE ALWAYS TRIGGER delivery_no_truncate;

CREATE FUNCTION notifications.complete_notification(p_claim uuid, p_provider_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  candidate notifications.outbox%ROWTYPE;
  state notifications.dispatch_state%ROWTYPE;
  previous notifications.delivery%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  IF p_claim IS NULL OR p_provider_ref IS NULL OR p_provider_ref !~ '^[A-Za-z0-9._:-]{1,200}$' THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: référence du prestataire invalide';
  END IF;
  -- Rejeu de la même confirmation : sans effet ; autre référence pour ce bail : refus.
  SELECT * INTO previous FROM notifications.delivery d WHERE d.claim_id = p_claim;
  IF FOUND THEN
    IF previous.provider_ref = p_provider_ref THEN RETURN; END IF;
    RAISE EXCEPTION 'NOTIFICATION_ALREADY_DELIVERED: notification déjà confirmée';
  END IF;
  -- Même ordre de verrous que la prise : enveloppe, puis état.
  SELECT o.* INTO candidate FROM notifications.outbox o JOIN notifications.dispatch_state s USING (recipient_id, event_key, channel)
    WHERE s.claim_id = p_claim FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_CLAIM_LOST: bail absent ou repris'; END IF;
  SELECT * INTO state FROM notifications.dispatch_state s
    WHERE s.recipient_id = candidate.recipient_id AND s.event_key = candidate.event_key AND s.channel = candidate.channel FOR UPDATE;
  IF state.claim_id IS DISTINCT FROM p_claim THEN RAISE EXCEPTION 'NOTIFICATION_CLAIM_LOST: bail absent ou repris'; END IF;
  IF EXISTS (SELECT 1 FROM notifications.delivery d
              WHERE d.recipient_id = candidate.recipient_id AND d.event_key = candidate.event_key AND d.channel = candidate.channel) THEN
    RAISE EXCEPTION 'NOTIFICATION_ALREADY_DELIVERED: notification déjà confirmée';
  END IF;
  INSERT INTO notifications.delivery (recipient_id, event_key, channel, claim_id, attempt, provider_ref, delivered_at)
    VALUES (candidate.recipient_id, candidate.event_key, candidate.channel, p_claim, state.attempt, p_provider_ref, clock_timestamp());
  UPDATE notifications.dispatch_state s SET claim_id = NULL, lease_until = NULL
    WHERE s.recipient_id = candidate.recipient_id AND s.event_key = candidate.event_key AND s.channel = candidate.channel;
END $$;

CREATE OR REPLACE FUNCTION notifications.claim_notification()
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
      -- 0078 : une notification confirmée n'est plus jamais reprise (pas de double envoi).
      AND NOT EXISTS (SELECT 1 FROM notifications.delivery d
        WHERE d.recipient_id = o.recipient_id AND d.event_key = o.event_key AND d.channel = o.channel)
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

CREATE OR REPLACE FUNCTION notifications.dispatch_counts()
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
    -- 0078 : une notification confirmée a quitté la file.
    WHERE NOT EXISTS (SELECT 1 FROM notifications.delivery d
      WHERE d.recipient_id = o.recipient_id AND d.event_key = o.event_key AND d.channel = o.channel)
  ) SELECT count(*) FILTER (WHERE category = 'pending'), count(*) FILTER (WHERE category = 'leased'),
    count(*) FILTER (WHERE category = 'retry_wait'), count(*) FILTER (WHERE category = 'exhausted'),
    count(*) FILTER (WHERE category = 'deferred') FROM classified;
END $$;

REVOKE ALL ON TABLE notifications.delivery FROM PUBLIC, app_rw, app_ro, notification_worker, notification_observer;
REVOKE ALL ON FUNCTION notifications.forbid_delivery_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.complete_notification(uuid, text) FROM PUBLIC, app_rw, app_ro, notification_observer;
GRANT EXECUTE ON FUNCTION notifications.complete_notification(uuid, text) TO notification_worker;

COMMIT;
