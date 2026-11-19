-- Migration 0066 — inscription et connexion du client garanties par la base
-- (C2, SEC-AUTH-001, F-ACC-001/002/004, D71). Dépend de 0004 (identity).
--
-- Le rôle applicatif pouvait créer un compte, un appareil ou une session sans
-- aucune preuve en base. Désormais, pour tout rôle qui n'est pas
-- superutilisateur (l'application) :
--   * un compte exige un OTP d'inscription consommé pour ce numéro depuis
--     moins de 10 minutes (la date de vérification est reprise de l'OTP) ;
--   * le premier appareil d'un compte exige la même preuve ; un appareil
--     suivant, un OTP « nouvel appareil » lié à son identifiant ;
--   * une session exige un défi de connexion de cet appareil consommé depuis
--     moins de 2 minutes et pas encore utilisé, ou un appareil enregistré
--     depuis moins de 10 minutes et encore sans session (inscription) ;
--   * 5 défis OTP au plus par numéro et par heure (envoi de SMS limité) ;
--   * l'acceptation des conditions (F-ACC-004) est conservée, horodatée par
--     la base, en ajout seul.
-- La signature du défi par la clé de l'appareil (Ed25519) est vérifiée par
-- l'application, la base ne disposant pas de cette primitive.

BEGIN;

CREATE FUNCTION identity.is_trusted_role() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false)
$fn$;
REVOKE ALL ON FUNCTION identity.is_trusted_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.is_trusted_role() TO app_rw, app_ro;

-- Compte : OTP d'inscription consommé pour ce numéro, récent.
CREATE FUNCTION identity.guard_account_signup() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  verified timestamptz;
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  SELECT max(c.consumed_at) INTO verified FROM identity.otp_challenge c
   WHERE c.phone = NEW.phone AND c.purpose = 'SIGNUP' AND c.binding = NEW.phone
     AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '10 minutes';
  IF verified IS NULL THEN
    RAISE EXCEPTION 'IDENTITY_OTP_INVALID: aucun OTP d''inscription vérifié récemment pour ce numéro';
  END IF;
  NEW.phone_verified_at := verified;
  RETURN NEW;
END $fn$;
CREATE TRIGGER account_signup_guard BEFORE INSERT ON identity.account
  FOR EACH ROW EXECUTE FUNCTION identity.guard_account_signup();
ALTER TABLE identity.account ENABLE ALWAYS TRIGGER account_signup_guard;

-- Appareil : premier appareil sur preuve d'inscription, suivants sur OTP « nouvel appareil ».
CREATE FUNCTION identity.guard_device_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  account_phone text;
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  SELECT a.phone INTO account_phone FROM identity.account a WHERE a.id = NEW.account_id AND a.status = 'ACTIVE';
  IF account_phone IS NULL THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte bloqué ou inconnu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.device d WHERE d.account_id = NEW.account_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM identity.otp_challenge c
       WHERE c.phone = account_phone AND c.purpose = 'SIGNUP' AND c.binding = account_phone
         AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '10 minutes'
    ) THEN
      RAISE EXCEPTION 'IDENTITY_OTP_INVALID: aucun OTP d''inscription vérifié récemment pour le premier appareil';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM identity.otp_challenge c
     WHERE c.phone = account_phone AND c.purpose = 'NEW_DEVICE' AND c.binding = NEW.id::text
       AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION 'IDENTITY_OTP_INVALID: aucun OTP « nouvel appareil » vérifié récemment pour cet appareil';
  END IF;
  NEW.registered_at := clock_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER device_enrollment_guard BEFORE INSERT ON identity.device
  FOR EACH ROW EXECUTE FUNCTION identity.guard_device_enrollment();
ALTER TABLE identity.device ENABLE ALWAYS TRIGGER device_enrollment_guard;

-- Défis de connexion d'un appareil (D71) : émis pour un appareil actif, 2 minutes, consommés une fois.
CREATE TABLE identity.device_login_challenge (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES identity.device (id) ON DELETE RESTRICT,
  challenge bytea NOT NULL CHECK (octet_length(challenge) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT device_login_challenge_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT device_login_challenge_window CHECK (expires_at = issued_at + interval '2 minutes'),
  CONSTRAINT device_login_challenge_consumed CHECK (consumed_at IS NULL OR consumed_at BETWEEN issued_at AND expires_at)
);
CREATE INDEX device_login_challenge_device_idx ON identity.device_login_challenge (device_id, consumed_at DESC);

CREATE FUNCTION identity.anchor_device_login_challenge() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM identity.device d JOIN identity.account a ON a.id = d.account_id
     WHERE d.id = NEW.device_id AND d.status = 'ACTIVE' AND a.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: appareil ou compte inactif';
  END IF;
  NEW.issued_at := clock_timestamp();
  NEW.expires_at := NEW.issued_at + interval '2 minutes';
  NEW.consumed_at := NULL;
  RETURN NEW;
END $fn$;

CREATE FUNCTION identity.consume_device_login_challenge() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR NEW.id <> OLD.id OR NEW.device_id <> OLD.device_id OR NEW.challenge <> OLD.challenge
     OR NEW.issued_at <> OLD.issued_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
  END IF;
  IF clock_timestamp() > OLD.expires_at THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: défi expiré';
  END IF;
  NEW.consumed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE FUNCTION identity.forbid_client_auth_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $fn$;

CREATE TRIGGER device_login_challenge_anchor BEFORE INSERT ON identity.device_login_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_device_login_challenge();
CREATE TRIGGER device_login_challenge_consume BEFORE UPDATE ON identity.device_login_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.consume_device_login_challenge();
CREATE TRIGGER device_login_challenge_no_delete BEFORE DELETE ON identity.device_login_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_client_auth_mutation();
CREATE TRIGGER device_login_challenge_no_truncate BEFORE TRUNCATE ON identity.device_login_challenge
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_client_auth_mutation();
ALTER TABLE identity.device_login_challenge ENABLE ALWAYS TRIGGER device_login_challenge_anchor;
ALTER TABLE identity.device_login_challenge ENABLE ALWAYS TRIGGER device_login_challenge_consume;
ALTER TABLE identity.device_login_challenge ENABLE ALWAYS TRIGGER device_login_challenge_no_delete;
ALTER TABLE identity.device_login_challenge ENABLE ALWAYS TRIGGER device_login_challenge_no_truncate;
GRANT SELECT, INSERT ON identity.device_login_challenge TO app_rw;
GRANT UPDATE (consumed_at) ON identity.device_login_challenge TO app_rw;
REVOKE DELETE, TRUNCATE ON identity.device_login_challenge FROM app_rw, app_ro;

-- Session : défi de connexion consommé et non encore utilisé, ou appareil neuf sans session.
CREATE FUNCTION identity.guard_session_opening() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  consumed timestamptz;
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  SELECT max(c.consumed_at) INTO consumed FROM identity.device_login_challenge c
   WHERE c.device_id = NEW.device_id AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '2 minutes';
  IF consumed IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM identity.session s WHERE s.device_id = NEW.device_id AND s.created_at >= consumed) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM identity.device d WHERE d.id = NEW.device_id AND d.registered_at >= clock_timestamp() - interval '10 minutes')
     AND NOT EXISTS (SELECT 1 FROM identity.session s WHERE s.device_id = NEW.device_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: aucun défi de connexion consommé pour cet appareil';
END $fn$;
CREATE TRIGGER session_opening_guard BEFORE INSERT ON identity.session
  FOR EACH ROW EXECUTE FUNCTION identity.guard_session_opening();
ALTER TABLE identity.session ENABLE ALWAYS TRIGGER session_opening_guard;

-- Envoi d'OTP : 5 défis au plus par numéro et par heure (protection contre l'envoi massif de SMS).
CREATE FUNCTION identity.limit_otp_issuance() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.otp:' || NEW.phone, 0));
  IF (SELECT count(*) FROM identity.otp_challenge c WHERE c.phone = NEW.phone AND c.created_at >= clock_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'REQUEST_RATE_LIMITED: trop de codes demandés pour ce numéro';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER otp_challenge_issuance_limit BEFORE INSERT ON identity.otp_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.limit_otp_issuance();
ALTER TABLE identity.otp_challenge ENABLE ALWAYS TRIGGER otp_challenge_issuance_limit;

-- F-ACC-004 : acceptation des conditions, horodatée par la base, en ajout seul.
CREATE TABLE identity.terms_acceptance (
  account_id uuid NOT NULL REFERENCES identity.account (id) ON DELETE RESTRICT,
  version text NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$'),
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, version)
);
CREATE FUNCTION identity.anchor_terms_acceptance() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.accepted_at := clock_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER terms_acceptance_anchor BEFORE INSERT ON identity.terms_acceptance
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_terms_acceptance();
CREATE TRIGGER terms_acceptance_no_update_delete BEFORE UPDATE OR DELETE ON identity.terms_acceptance
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_client_auth_mutation();
CREATE TRIGGER terms_acceptance_no_truncate BEFORE TRUNCATE ON identity.terms_acceptance
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_client_auth_mutation();
ALTER TABLE identity.terms_acceptance ENABLE ALWAYS TRIGGER terms_acceptance_anchor;
ALTER TABLE identity.terms_acceptance ENABLE ALWAYS TRIGGER terms_acceptance_no_update_delete;
ALTER TABLE identity.terms_acceptance ENABLE ALWAYS TRIGGER terms_acceptance_no_truncate;
GRANT SELECT, INSERT ON identity.terms_acceptance TO app_rw;
GRANT SELECT ON identity.terms_acceptance TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON identity.terms_acceptance FROM app_rw, app_ro;

REVOKE ALL ON FUNCTION identity.guard_account_signup() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.guard_device_enrollment() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.anchor_device_login_challenge() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.consume_device_login_challenge() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.forbid_client_auth_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.guard_session_opening() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.limit_otp_issuance() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.anchor_terms_acceptance() FROM PUBLIC;

COMMIT;
