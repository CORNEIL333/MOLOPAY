-- Migration 0025 — quotas des routes compte (SEC-API-003, partiel).
-- Dépend de 0023 (identity.lock_security_actor).
-- Politiques versionnées, en ajout seul, sans valeur par défaut : tant que le
-- propriétaire de migration n'en a pas inséré, les routes concernées répondent
-- 503 (fermé par défaut). Le rôle applicatif n'accède aux compteurs que par la
-- fonction consume_customer_quota. Une tentative admise est validée avant la
-- commande : elle compte même si la commande échoue ensuite. Un refus n'écrit
-- rien (tout ou rien sur les deux dimensions). Le verrou du compte sérialise
-- les consommations ; l'horloge utilisée est celle du serveur à l'instant de
-- la décision, après l'attente du verrou.
-- Déconnexion et blocage ne sont pas dans la liste : ces chemins de sécurité
-- restent disponibles, même quota saturé.

BEGIN;

CREATE TABLE identity.customer_quota_policy (
  action text NOT NULL
    CHECK (action IN ('SECURITY_READ', 'REVOKE_OTHERS', 'DATA_RIGHTS_READ', 'DATA_RIGHTS_SUBMIT')),
  version integer NOT NULL CHECK (version >= 1),
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  account_limit integer NOT NULL CHECK (account_limit >= 1),
  device_limit integer NOT NULL CHECK (device_limit >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (action, version)
);

CREATE TABLE identity.customer_quota_counter (
  action text NOT NULL,
  version integer NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('ACCOUNT', 'DEVICE')),
  subject_id uuid NOT NULL,
  used integer NOT NULL CHECK (used >= 1),
  resets_at timestamptz NOT NULL,
  PRIMARY KEY (action, version, dimension, subject_id),
  FOREIGN KEY (action, version)
    REFERENCES identity.customer_quota_policy (action, version)
);

CREATE FUNCTION identity.reject_quota_policy_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'RATE_LIMIT_POLICY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- Versions sans trou, horodatage serveur.
CREATE FUNCTION identity.anchor_quota_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE latest integer;
BEGIN
  SELECT max(version) INTO latest
  FROM identity.customer_quota_policy WHERE action = NEW.action;
  IF NEW.version <> COALESCE(latest, 0) + 1 THEN
    RAISE EXCEPTION 'REQUEST_INVALID: version % attendue, % reçue',
      COALESCE(latest, 0) + 1, NEW.version;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER customer_quota_policy_anchor
  BEFORE INSERT ON identity.customer_quota_policy
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_quota_policy();
CREATE TRIGGER customer_quota_policy_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON identity.customer_quota_policy
  FOR EACH STATEMENT EXECUTE FUNCTION identity.reject_quota_policy_mutation();
ALTER TABLE identity.customer_quota_policy ENABLE ALWAYS TRIGGER customer_quota_policy_anchor;
ALTER TABLE identity.customer_quota_policy ENABLE ALWAYS TRIGGER customer_quota_policy_append_only;

CREATE FUNCTION identity.consume_customer_quota(
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
     OR p_action NOT IN ('SECURITY_READ', 'REVOKE_OTHERS', 'DATA_RIGHTS_READ', 'DATA_RIGHTS_SUBMIT') THEN
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

REVOKE ALL ON identity.customer_quota_policy, identity.customer_quota_counter
  FROM PUBLIC, app_ro, app_rw;
REVOKE ALL ON FUNCTION identity.consume_customer_quota(uuid, uuid, uuid, text),
  identity.reject_quota_policy_mutation(), identity.anchor_quota_policy()
  FROM PUBLIC, app_ro, app_rw;
GRANT EXECUTE ON FUNCTION identity.consume_customer_quota(uuid, uuid, uuid, text) TO app_rw;

COMMIT;
