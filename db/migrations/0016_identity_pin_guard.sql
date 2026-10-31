-- Migration 0016 — verrouillage PIN imposé par la base (SEC-AUTH-002).
-- Dépend de 0004.
-- L'application vérifie le PIN (Argon2id + poivre) ; la base garantit que les
-- compteurs ne peuvent être que :
--   * incrémentés d'un essai,
--   * remis à zéro (succès ou passage en verrouillage),
--   * verrouillés pour une durée future, avec un nombre de verrous croissant,
-- et qu'aucune modification n'a lieu pendant un verrouillage actif. Un
-- applicatif compromis ne peut donc ni effacer un verrou en cours, ni faire
-- régresser le nombre de verrous. updated_at suit l'horloge serveur.

BEGIN;

CREATE FUNCTION identity.guard_pin_credential() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  now_ts timestamptz := clock_timestamp();
BEGIN
  IF OLD.locked_until IS NOT NULL AND OLD.locked_until > now_ts THEN
    RAISE EXCEPTION 'IDENTITY_PIN_LOCKED: verrouillage actif jusqu''à %', OLD.locked_until;
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: rattachement du PIN immuable';
  END IF;
  IF NEW.lockouts < OLD.lockouts OR NEW.lockouts > OLD.lockouts + 1 THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: nombre de verrous non monotone';
  END IF;
  IF NEW.lockouts = OLD.lockouts + 1 THEN
    -- Passage en verrouillage : compteur remis à zéro, échéance future.
    IF NEW.failed_attempts <> 0 OR NEW.locked_until IS NULL OR NEW.locked_until <= now_ts
       OR OLD.failed_attempts <> 4 THEN
      RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: verrouillage incohérent';
    END IF;
  ELSE
    IF NEW.locked_until IS NOT NULL THEN
      RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: verrouillage sans incrément';
    END IF;
    IF NEW.failed_attempts <> 0 AND NEW.failed_attempts <> OLD.failed_attempts + 1 THEN
      RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: essais décomptés un par un';
    END IF;
  END IF;
  NEW.updated_at := now_ts;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION identity.guard_pin_credential() FROM PUBLIC;

CREATE TRIGGER pin_credential_guard
  BEFORE UPDATE ON identity.pin_credential
  FOR EACH ROW EXECUTE FUNCTION identity.guard_pin_credential();
ALTER TABLE identity.pin_credential ENABLE ALWAYS TRIGGER pin_credential_guard;

COMMIT;
