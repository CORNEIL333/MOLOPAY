-- Migration 0076 — plus aucun numéro de téléphone en clair en base (C14,
-- SEC-CRY-002, ADR-0004 ; décision du fondateur du 25 novembre : téléphone
-- chiffré, nom légal laissé lisible pour le filtrage en base).
-- Dépend de 0004, 0007, 0066, 0075.
--
-- Les colonnes `phone` (compte, défi OTP) et `old_phone`/`new_phone`
-- (récupération) gardent leur nom mais ne contiennent plus que l'EMPREINTE À
-- CLÉ du numéro (HMAC-SHA-256, 64 hexadécimaux, clé d'index hors base) :
-- toutes les règles existantes (unicité, défi lié au numéro, quota par numéro,
-- récupération) restent exactes, car elles ne font que comparer. Le numéro
-- lui-même n'est stocké que chiffré par enveloppe (`phone_ciphertext`, format
-- `v1.`, clé de données emballée par AWS KMS) et, pour l'affichage, masqué
-- (`phone_masked`, indicatif + deux derniers chiffres). Ils sont écrits à
-- l'émission du code d'inscription (seul moment où l'application voit le
-- numéro) puis recopiés dans le compte : la base vérifie la recopie.
--
-- Aucune donnée réelle n'existe (ADR-0004) : la migration refuse de
-- s'appliquer sur des lignes au numéro en clair, plutôt que de les convertir.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.account) OR EXISTS (SELECT 1 FROM identity.otp_challenge) OR EXISTS (SELECT 1 FROM identity.recovery) THEN
    RAISE EXCEPTION 'IDENTITY_MIGRATION_REFUSED: numéros en clair présents ; conversion manuelle requise';
  END IF;
END $$;

ALTER TABLE identity.account DROP CONSTRAINT account_phone_check;
ALTER TABLE identity.account ADD CONSTRAINT account_phone_key_format CHECK (phone ~ '^[0-9a-f]{64}$');
ALTER TABLE identity.account
  ADD COLUMN phone_ciphertext text NOT NULL CHECK (phone_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'),
  ADD COLUMN phone_masked text NOT NULL CHECK (phone_masked ~ '^\+[1-9][0-9]{2}•{3,12}[0-9]{2}$');
COMMENT ON COLUMN identity.account.phone IS 'Empreinte à clé du numéro (HMAC-SHA-256) ; jamais le numéro en clair (C14)';

ALTER TABLE identity.otp_challenge DROP CONSTRAINT otp_challenge_phone_check;
ALTER TABLE identity.otp_challenge ADD CONSTRAINT otp_challenge_phone_key_format CHECK (phone ~ '^[0-9a-f]{64}$');
ALTER TABLE identity.otp_challenge
  ADD COLUMN phone_ciphertext text CHECK (phone_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'),
  ADD COLUMN phone_masked text CHECK (phone_masked ~ '^\+[1-9][0-9]{2}•{3,12}[0-9]{2}$'),
  ADD CONSTRAINT otp_challenge_signup_carries_phone CHECK (purpose <> 'SIGNUP' OR (phone_ciphertext IS NOT NULL AND phone_masked IS NOT NULL));
COMMENT ON COLUMN identity.otp_challenge.phone IS 'Empreinte à clé du numéro (HMAC-SHA-256) ; jamais le numéro en clair (C14)';

ALTER TABLE identity.recovery DROP CONSTRAINT recovery_old_phone_check;
ALTER TABLE identity.recovery DROP CONSTRAINT recovery_new_phone_check;
ALTER TABLE identity.recovery ADD CONSTRAINT recovery_phone_keys_format CHECK (old_phone ~ '^[0-9a-f]{64}$' AND new_phone ~ '^[0-9a-f]{64}$');

-- Inscription (reprise de 0066) : en plus de l'OTP consommé, le chiffré et le
-- masque du compte sont ceux du défi consommé (aucun numéro substitué).
CREATE OR REPLACE FUNCTION identity.guard_account_signup() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  verified record;
BEGIN
  IF identity.is_trusted_role() THEN
    RETURN NEW;
  END IF;
  -- Le chiffré du compte doit être celui d'UN code d'inscription vérifié récemment pour ce numéro
  -- (deux codes simultanés portent deux chiffrés différents : chacun vaut pour son inscription).
  SELECT max(c.consumed_at) AS consumed_at INTO verified FROM identity.otp_challenge c
   WHERE c.phone = NEW.phone AND c.purpose = 'SIGNUP' AND c.binding = NEW.phone
     AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '10 minutes';
  IF verified.consumed_at IS NULL THEN
    RAISE EXCEPTION 'IDENTITY_OTP_INVALID: aucun OTP d''inscription vérifié récemment pour ce numéro';
  END IF;
  SELECT max(c.consumed_at) AS consumed_at INTO verified FROM identity.otp_challenge c
   WHERE c.phone = NEW.phone AND c.purpose = 'SIGNUP' AND c.binding = NEW.phone
     AND c.consumed_at IS NOT NULL AND c.consumed_at >= clock_timestamp() - interval '10 minutes'
     AND c.phone_ciphertext = NEW.phone_ciphertext AND c.phone_masked = NEW.phone_masked;
  IF verified.consumed_at IS NULL THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: numéro chiffré différent de celui du code vérifié';
  END IF;
  NEW.phone_verified_at := verified.consumed_at;
  RETURN NEW;
END $fn$;

GRANT INSERT (phone_ciphertext, phone_masked) ON identity.account TO app_rw;
GRANT INSERT (phone_ciphertext, phone_masked) ON identity.otp_challenge TO app_rw;

COMMIT;
