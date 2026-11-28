-- Migration 0080 — D121 (fondateur, 28 novembre) : langue choisie dans
-- l'application et canal SMS activé par type de notification.
--
-- - identity.language_preference : la langue déclarée par l'application du
--   client, en ajout seul ; la dernière déclaration fait foi ; sans
--   déclaration, le français (langue de référence).
-- - notifications.sms_channel_setting : bascule SMS par type de notification,
--   posée par l'équipe (motif obligatoire), en ajout seul ; la dernière
--   bascule fait foi ; sans bascule, SMS désactivé (le push est le canal de
--   lancement).
-- Les deux lectures passent par des fonctions : aucune autre voie d'accès.

BEGIN;

CREATE FUNCTION identity.forbid_language_preference_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur identity.language_preference refusé', TG_OP;
END $fn$;

CREATE TABLE identity.language_preference (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.account (id) ON DELETE RESTRICT,
  language text NOT NULL CHECK (language IN ('fr', 'en')),
  declared_at timestamptz NOT NULL
);
CREATE INDEX language_preference_latest ON identity.language_preference (account_id, seq DESC);

CREATE FUNCTION identity.anchor_language_preference() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.declared_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE TRIGGER language_preference_anchor BEFORE INSERT ON identity.language_preference
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_language_preference();
CREATE TRIGGER language_preference_no_update_delete BEFORE UPDATE OR DELETE ON identity.language_preference
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_language_preference_mutation();
CREATE TRIGGER language_preference_no_truncate BEFORE TRUNCATE ON identity.language_preference
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_language_preference_mutation();
ALTER TABLE identity.language_preference ENABLE ALWAYS TRIGGER language_preference_anchor;
ALTER TABLE identity.language_preference ENABLE ALWAYS TRIGGER language_preference_no_update_delete;
ALTER TABLE identity.language_preference ENABLE ALWAYS TRIGGER language_preference_no_truncate;

REVOKE ALL ON identity.language_preference FROM PUBLIC;

-- Déclaration par le client authentifié (compte actif) ; rien n'est écrit si la langue ne change pas.
CREATE FUNCTION identity.declare_language(p_account uuid, p_language text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  current_language text;
BEGIN
  IF p_language IS NULL OR p_language NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'IDENTITY_LANGUAGE_INVALID: langue non prise en charge';
  END IF;
  PERFORM 1 FROM identity.account a WHERE a.id = p_account AND a.status = 'ACTIVE' FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte absent ou inactif';
  END IF;
  SELECT l.language INTO current_language FROM identity.language_preference l
   WHERE l.account_id = p_account ORDER BY l.seq DESC LIMIT 1;
  IF current_language IS DISTINCT FROM p_language THEN
    INSERT INTO identity.language_preference (account_id, language) VALUES (p_account, p_language);
  END IF;
  RETURN p_language;
END $fn$;

CREATE FUNCTION identity.preferred_language(p_account uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT l.language FROM identity.language_preference l WHERE l.account_id = p_account ORDER BY l.seq DESC LIMIT 1),
    'fr')
$fn$;

REVOKE ALL ON FUNCTION identity.forbid_language_preference_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.anchor_language_preference() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.declare_language(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.preferred_language(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.declare_language(uuid, text) TO app_rw;
GRANT EXECUTE ON FUNCTION identity.preferred_language(uuid) TO app_rw, app_ro;

CREATE FUNCTION notifications.forbid_sms_channel_setting_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'NOTIFICATION_APPEND_ONLY: % sur notifications.sms_channel_setting refusé', TG_OP;
END $fn$;

CREATE TABLE notifications.sms_channel_setting (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('PAYMENT_CONFIRMED','PAYMENT_REMINDER','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED')),
  enabled boolean NOT NULL,
  set_by text NOT NULL CHECK (set_by ~ '^[^[:space:]]{1,100}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  set_at timestamptz NOT NULL
);
CREATE INDEX sms_channel_setting_latest ON notifications.sms_channel_setting (event_type, seq DESC);

CREATE FUNCTION notifications.anchor_sms_channel_setting() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.set_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE TRIGGER sms_channel_setting_anchor BEFORE INSERT ON notifications.sms_channel_setting
  FOR EACH ROW EXECUTE FUNCTION notifications.anchor_sms_channel_setting();
CREATE TRIGGER sms_channel_setting_no_update_delete BEFORE UPDATE OR DELETE ON notifications.sms_channel_setting
  FOR EACH ROW EXECUTE FUNCTION notifications.forbid_sms_channel_setting_mutation();
CREATE TRIGGER sms_channel_setting_no_truncate BEFORE TRUNCATE ON notifications.sms_channel_setting
  FOR EACH STATEMENT EXECUTE FUNCTION notifications.forbid_sms_channel_setting_mutation();
ALTER TABLE notifications.sms_channel_setting ENABLE ALWAYS TRIGGER sms_channel_setting_anchor;
ALTER TABLE notifications.sms_channel_setting ENABLE ALWAYS TRIGGER sms_channel_setting_no_update_delete;
ALTER TABLE notifications.sms_channel_setting ENABLE ALWAYS TRIGGER sms_channel_setting_no_truncate;

REVOKE ALL ON notifications.sms_channel_setting FROM PUBLIC;

-- Bascule par l'équipe : refusée si elle ne change rien (état déjà demandé).
CREATE FUNCTION notifications.set_sms_channel(p_event text, p_enabled boolean, p_actor text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  current_state boolean;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'NOTIFICATION_INVALID_REQUEST: état absent';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('notifications.sms_channel:' || COALESCE(p_event, ''), 0));
  SELECT s.enabled INTO current_state FROM notifications.sms_channel_setting s
   WHERE s.event_type = p_event ORDER BY s.seq DESC LIMIT 1;
  IF COALESCE(current_state, false) = p_enabled THEN
    RAISE EXCEPTION 'NOTIFICATION_CHANNEL_UNCHANGED: canal SMS déjà dans cet état';
  END IF;
  INSERT INTO notifications.sms_channel_setting (event_type, enabled, set_by, reason)
  VALUES (p_event, p_enabled, p_actor, p_reason);
END $fn$;

CREATE FUNCTION notifications.sms_enabled(p_event text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT s.enabled FROM notifications.sms_channel_setting s WHERE s.event_type = p_event ORDER BY s.seq DESC LIMIT 1),
    false)
$fn$;

-- État courant de chaque type, pour le back-office (sans identifiant client).
CREATE FUNCTION notifications.sms_channel_states()
RETURNS TABLE (event_type text, enabled boolean, set_by text, set_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT e.event_type, COALESCE(s.enabled, false), s.set_by, s.set_at
    FROM unnest(ARRAY['PAYMENT_CONFIRMED','PAYMENT_REMINDER','GOAL_FUNDED','HANDOVER_READY','SETTLEMENT_CONFIRMED','DISPUTE_UPDATED']) WITH ORDINALITY AS e(event_type, position)
    LEFT JOIN LATERAL (
      SELECT x.enabled, x.set_by, x.set_at FROM notifications.sms_channel_setting x
       WHERE x.event_type = e.event_type ORDER BY x.seq DESC LIMIT 1
    ) s ON true
   ORDER BY e.position
$fn$;

REVOKE ALL ON FUNCTION notifications.forbid_sms_channel_setting_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.anchor_sms_channel_setting() FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.set_sms_channel(text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.sms_enabled(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.sms_channel_states() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.set_sms_channel(text, boolean, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION notifications.sms_enabled(text) TO app_rw;
GRANT EXECUTE ON FUNCTION notifications.sms_channel_states() TO app_rw;

COMMIT;
