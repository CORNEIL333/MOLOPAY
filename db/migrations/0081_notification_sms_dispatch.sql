-- Migration 0081 — D121, tranche 2 : distribution des SMS (travailleur
-- `pnpm notify:worker`, rôle notification_worker).
--
-- - notifications.claim_sms_notification() : même prise que
--   claim_notification (bail, tentatives, jamais une notification confirmée),
--   limitée au canal SMS. Les rappels (PAYMENT_REMINDER) ne sont pris
--   qu'entre 8 h et 20 h, heure de Douala (F-NOT-003, plages acceptées par le
--   fondateur le 28 novembre) ; hors plage, ils attendent, sans tentative
--   consommée. Les confirmations partent à toute heure.
-- - notifications.claimed_sms_recipient(claim) : empreinte et chiffré du
--   numéro du destinataire, pour le seul bail SMS en cours et un compte actif.
--   Le numéro n'est jamais en clair en base (C14) ; le travailleur le
--   déchiffre avec la clé KMS, au moment de l'envoi, sans le journaliser.
-- Le push reste en file tant que son prestataire n'est pas choisi (D122).
-- - Politique de consommation par défaut, posée seulement si aucune n'existe :
--   bail de 60 s (l'envoi Twilio est borné à 10 s), nouvel essai après 5 min,
--   5 tentatives au plus ; une notification épuisée est signalée par la
--   supervision (0079). Choix prudent et réversible (journal D121).

BEGIN;

INSERT INTO notifications.dispatch_policy (id, lease_ms, retry_ms, max_attempts)
VALUES (1, 60000, 300000, 5)
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION notifications.within_reminder_window(p_at timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT (p_at AT TIME ZONE 'Africa/Douala')::time >= time '08:00'
     AND (p_at AT TIME ZONE 'Africa/Douala')::time < time '20:00'
$fn$;

CREATE FUNCTION notifications.claim_sms_notification()
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
    WHERE o.channel = 'SMS'
      AND (o.event_type IN ('PAYMENT_CONFIRMED','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED')
           OR (o.event_type = 'PAYMENT_REMINDER' AND notifications.within_reminder_window(instant)))
      AND (s.attempt IS NULL OR (s.attempt < s.attempt_limit AND coalesce(s.lease_until, s.available_at) <= instant))
      AND NOT EXISTS (SELECT 1 FROM notifications.delivery d
        WHERE d.recipient_id = o.recipient_id AND d.event_key = o.event_key AND d.channel = o.channel)
    ORDER BY o.created_at, o.recipient_id, o.event_key, o.channel
    LIMIT 1 FOR UPDATE OF o SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
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

CREATE FUNCTION notifications.claimed_sms_recipient(p_claim uuid)
RETURNS TABLE (phone_key text, phone_ciphertext text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN QUERY
    SELECT a.phone, a.phone_ciphertext
      FROM notifications.dispatch_state s
      JOIN identity.account a ON a.id = s.recipient_id
     WHERE s.claim_id = p_claim
       AND s.channel = 'SMS'
       AND s.lease_until > clock_timestamp()
       AND a.status = 'ACTIVE'
       AND a.phone_ciphertext IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION notifications.within_reminder_window(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.claim_sms_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.claimed_sms_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.claim_sms_notification() TO notification_worker;
GRANT EXECUTE ON FUNCTION notifications.claimed_sms_recipient(uuid) TO notification_worker;

COMMIT;
