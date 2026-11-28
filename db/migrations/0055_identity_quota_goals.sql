-- Migration 0055 — quotas des routes d'objectifs (SEC-API-003, D61).
-- Dépend de 0054 (dernière version de identity.consume_customer_quota).
--
-- GOAL_CREATE : création d'un brouillon. GOAL_SIGNED_ACTION : activation,
-- annulation et verrou sous PIN (un budget commun). Fonction reprise de 0054,
-- seule la liste des actions change (diff vérifié). Valeurs par délégation
-- du fondateur (D61), nouvelle version de politique.

BEGIN;

ALTER TABLE identity.customer_quota_policy DROP CONSTRAINT customer_quota_policy_action_check;
ALTER TABLE identity.customer_quota_policy ADD CONSTRAINT customer_quota_policy_action_check
  CHECK (action IN ('SECURITY_READ', 'REVOKE_OTHERS', 'DATA_RIGHTS_READ', 'DATA_RIGHTS_SUBMIT',
                    'BENEFICIARY_DOCUMENT_SUBMIT', 'BENEFICIARY_PAYMENT',
                    'GOAL_CREATE', 'GOAL_SIGNED_ACTION'));

CREATE OR REPLACE FUNCTION identity.consume_customer_quota(
  p_account uuid, p_device uuid, p_session uuid, p_action text
)
RETURNS TABLE (outcome text, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  policy identity.customer_quota_policy%ROWTYPE;
  instant timestamptz;
  retry numeric := 0;
  counter identity.customer_quota_counter%ROWTYPE;
BEGIN
  PERFORM identity.lock_security_actor(p_account, p_device, p_session);
  IF p_action IS NULL
     OR p_action NOT IN ('SECURITY_READ', 'REVOKE_OTHERS', 'DATA_RIGHTS_READ', 'DATA_RIGHTS_SUBMIT',
                         'BENEFICIARY_DOCUMENT_SUBMIT', 'BENEFICIARY_PAYMENT',
                         'GOAL_CREATE', 'GOAL_SIGNED_ACTION') THEN
    RAISE EXCEPTION 'REQUEST_INVALID: action de quota inconnue';
  END IF;
  SELECT * INTO policy FROM identity.customer_quota_policy p
  WHERE p.action = p_action ORDER BY p.version DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'UNCONFIGURED'::text, NULL::integer;
    RETURN;
  END IF;
  instant := clock_timestamp();

  SELECT * INTO counter FROM identity.customer_quota_counter c
  WHERE c.action = p_action AND c.version = policy.version
    AND c.dimension = 'ACCOUNT' AND c.subject_id = p_account;
  IF FOUND AND counter.resets_at > instant AND counter.used >= policy.account_limit THEN
    retry := GREATEST(retry, ceil(extract(epoch FROM counter.resets_at - instant)));
  END IF;
  SELECT * INTO counter FROM identity.customer_quota_counter c
  WHERE c.action = p_action AND c.version = policy.version
    AND c.dimension = 'DEVICE' AND c.subject_id = p_device;
  IF FOUND AND counter.resets_at > instant AND counter.used >= policy.device_limit THEN
    retry := GREATEST(retry, ceil(extract(epoch FROM counter.resets_at - instant)));
  END IF;
  IF retry > 0 THEN
    RETURN QUERY SELECT 'LIMITED'::text, LEAST(GREATEST(retry, 1), 86400)::integer;
    RETURN;
  END IF;

  INSERT INTO identity.customer_quota_counter AS c
    (action, version, dimension, subject_id, used, resets_at)
  VALUES
    (p_action, policy.version, 'ACCOUNT', p_account, 1,
     instant + make_interval(secs => policy.window_seconds)),
    (p_action, policy.version, 'DEVICE', p_device, 1,
     instant + make_interval(secs => policy.window_seconds))
  ON CONFLICT (action, version, dimension, subject_id) DO UPDATE
  SET used = CASE WHEN c.resets_at <= instant THEN 1 ELSE c.used + 1 END,
      resets_at = CASE WHEN c.resets_at <= instant THEN EXCLUDED.resets_at ELSE c.resets_at END;
  RETURN QUERY SELECT 'ALLOWED'::text, NULL::integer;
END $$;

INSERT INTO identity.customer_quota_policy (action, version, window_seconds, account_limit, device_limit)
SELECT v.action,
       COALESCE((SELECT max(p.version) FROM identity.customer_quota_policy p
                 WHERE p.action = v.action), 0) + 1,
       v.window_seconds, v.account_limit, v.device_limit
FROM (VALUES
  ('GOAL_CREATE',        86400, 20, 20),
  ('GOAL_SIGNED_ACTION',  3600, 10, 10)
) AS v(action, window_seconds, account_limit, device_limit);

COMMIT;
