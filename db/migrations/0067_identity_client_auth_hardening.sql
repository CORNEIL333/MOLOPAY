-- Migration 0067 — durcissement après la revue indépendante du 20 novembre
-- (C2, SEC-AUTH-001, SEC-AUTH-005, D71). Dépend de 0066.
--
-- Portée réelle des gardes en base (rectifiée) : elles protègent contre une
-- ERREUR de l'application (session ou compte ouverts sans la preuve exigée),
-- pas contre un rôle applicatif compromis : `app_rw` marque lui-même un OTP
-- ou un défi comme consommé (la base ne connaît ni le poivre des codes, ni la
-- primitive Ed25519). La preuve forte reste la vérification applicative et
-- l'audit.
--
-- Corrections :
--   * une session n'est ouverte que pour le compte propriétaire de
--     l'appareil, et son horodatage de création est celui de la base (un
--     `created_at` antidaté permettait de réutiliser un défi consommé) ;
--   * les défis portent un objet (LOGIN ou REFRESH, immuable) : un défi de
--     renouvellement ne peut pas ouvrir de session ;
--   * 10 défis non consommés au plus par appareil sur 10 minutes (la table,
--     en ajout seul, ne peut pas grossir sans limite).

BEGIN;

ALTER TABLE identity.device_login_challenge
  ADD COLUMN purpose text NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN ('LOGIN', 'REFRESH'));

CREATE OR REPLACE FUNCTION identity.anchor_device_login_challenge() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM identity.device d JOIN identity.account a ON a.id = d.account_id
     WHERE d.id = NEW.device_id AND d.status = 'ACTIVE' AND a.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: appareil ou compte inactif';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.device-challenge:' || NEW.device_id::text, 0));
  IF (SELECT count(*) FROM identity.device_login_challenge c
       WHERE c.device_id = NEW.device_id AND c.consumed_at IS NULL
         AND c.issued_at >= clock_timestamp() - interval '10 minutes') >= 10 THEN
    RAISE EXCEPTION 'REQUEST_RATE_LIMITED: trop de défis de connexion pour cet appareil';
  END IF;
  NEW.issued_at := clock_timestamp();
  NEW.expires_at := NEW.issued_at + interval '2 minutes';
  NEW.consumed_at := NULL;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION identity.consume_device_login_challenge() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR NEW.id <> OLD.id OR NEW.device_id <> OLD.device_id OR NEW.challenge <> OLD.challenge
     OR NEW.issued_at <> OLD.issued_at OR NEW.expires_at <> OLD.expires_at OR NEW.purpose <> OLD.purpose THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
  END IF;
  IF clock_timestamp() > OLD.expires_at THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: défi expiré';
  END IF;
  NEW.consumed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION identity.guard_session_opening() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  consumed timestamptz;
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  -- Horodatage de la base (création et émission de l'accès) : un `created_at` antidaté ne doit pas faire
  -- paraître un défi « encore inutilisé ».
  NEW.created_at := clock_timestamp();
  NEW.access_issued_at := NEW.created_at;
  IF NOT EXISTS (SELECT 1 FROM identity.device d WHERE d.id = NEW.device_id AND d.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: appareil d''un autre compte';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.session-opening:' || NEW.device_id::text, 0));
  SELECT max(c.consumed_at) INTO consumed FROM identity.device_login_challenge c
   WHERE c.device_id = NEW.device_id AND c.purpose = 'LOGIN'
     AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '2 minutes';
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

COMMIT;
