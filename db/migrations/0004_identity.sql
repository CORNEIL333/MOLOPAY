-- Migration 0004 — identité : OTP, PIN Argon2id, appareils, sessions,
-- signatures de transaction et récupération.
-- Exigences : F-ACC-001/002/006, SEC-AUTH-001/002/003/005/007.
-- Aucun code OTP, PIN ou jeton n'est stocké en clair : seules les empreintes
-- sont conservées. Les migrations sont additives ; les corrections passent
-- par une nouvelle migration.

BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

-- Ajoute IDENTITY_ACTION au vocabulaire d'audit sans réécrire 0002.
-- La contrainte inline de 0002 s'appelle event_event_type_check ; la cible
-- est explicite et l'opération reste rejouable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'audit.event'::regclass
      AND conname = 'event_event_type_check'
  ) THEN
    ALTER TABLE audit.event DROP CONSTRAINT event_event_type_check;
  END IF;
END $$;

ALTER TABLE audit.event DROP CONSTRAINT IF EXISTS event_type_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_type_check CHECK (event_type IN (
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'PERMISSION_CHANGED',
  'SENSITIVE_DATA_READ',
  'FINANCIAL_HISTORY_READ',
  'BACKOFFICE_ACTION',
  'CONFIG_CHANGED',
  'EXPORT_CREATED',
  'IDENTITY_ACTION'
));

CREATE TABLE identity.account (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE
    CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'BLOCKED')),
  phone_verified_at timestamptz NOT NULL,
  kyc_level text NOT NULL DEFAULT 'NONE'
    CHECK (kyc_level IN ('NONE', 'BASIC', 'STRONG')),
  blocked_at timestamptz,
  block_channel text CHECK (
    block_channel IS NULL
    OR block_channel IN ('USSD', 'SUPPORT', 'TRUSTED_DEVICE', 'APP')
  ),
  block_reason text CHECK (
    block_reason IS NULL OR length(block_reason) BETWEEN 1 AND 500
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT account_block_consistent CHECK (
    (status = 'ACTIVE'
      AND blocked_at IS NULL
      AND block_channel IS NULL
      AND block_reason IS NULL)
    OR (status = 'BLOCKED'
      AND blocked_at IS NOT NULL
      AND block_channel IS NOT NULL
      AND block_reason IS NOT NULL)
  )
);

CREATE TABLE identity.otp_challenge (
  id uuid PRIMARY KEY,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text NOT NULL CHECK (purpose IN ('SIGNUP', 'NEW_DEVICE', 'RECOVERY')),
  binding text NOT NULL CHECK (length(binding) BETWEEN 1 AND 200),
  code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  expires_at timestamptz NOT NULL,
  attempts_remaining smallint NOT NULL
    CHECK (attempts_remaining BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT otp_consumed_once CHECK (
    consumed_at IS NULL OR consumed_at <= expires_at
  )
);

CREATE FUNCTION identity.protect_otp_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: suppression OTP interdite';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.phone <> OLD.phone
     OR NEW.purpose <> OLD.purpose
     OR NEW.binding <> OLD.binding
     OR NEW.code_hash IS DISTINCT FROM OLD.code_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: champs OTP immuables';
  END IF;
  IF NEW.attempts_remaining > OLD.attempts_remaining THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: essais OTP seulement décroissants';
  END IF;
  IF OLD.consumed_at IS NOT NULL
     AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: OTP déjà consommé';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER otp_challenge_protect
  BEFORE UPDATE OR DELETE ON identity.otp_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.protect_otp_challenge();

-- Un défi OTP ne peut pas être émis avec une validité arbitrairement longue
-- (le domaine plafonne à dix minutes).
CREATE FUNCTION identity.anchor_otp_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'IDENTITY_OTP_INVALID: expiration hors fenêtre réelle';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER otp_challenge_anchor
  BEFORE INSERT ON identity.otp_challenge
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_otp_challenge();

CREATE TABLE identity.device (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.account(id) ON DELETE RESTRICT,
  public_key_pem text NOT NULL CHECK (
    length(public_key_pem) BETWEEN 1 AND 2000
    AND public_key_pem LIKE '%BEGIN PUBLIC KEY%'
    AND public_key_pem NOT LIKE '%PRIVATE KEY%'
  ),
  fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  registered_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (account_id, fingerprint),
  CONSTRAINT device_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT device_revocation_consistent CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX device_account_idx ON identity.device (account_id);

CREATE TABLE identity.pin_credential (
  device_id uuid PRIMARY KEY
    REFERENCES identity.device(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL
    REFERENCES identity.account(id) ON DELETE RESTRICT,
  pin_hash text NOT NULL CHECK (
    length(pin_hash) BETWEEN 1 AND 1000
    AND pin_hash LIKE '$argon2id$%'
  ),
  failed_attempts smallint NOT NULL DEFAULT 0
    CHECK (failed_attempts BETWEEN 0 AND 4),
  lockouts smallint NOT NULL DEFAULT 0 CHECK (lockouts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT pin_lockout_consistent CHECK (
    locked_until IS NULL OR failed_attempts = 0
  )
);

CREATE TABLE identity.session (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL
    REFERENCES identity.account(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL
    REFERENCES identity.device(id) ON DELETE RESTRICT,
  access_token_hash bytea NOT NULL
    CHECK (octet_length(access_token_hash) = 32),
  refresh_token_hash bytea NOT NULL
    CHECK (octet_length(refresh_token_hash) = 32),
  access_issued_at timestamptz NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT session_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT session_access_window CHECK (
    access_issued_at >= created_at
    AND access_expires_at > access_issued_at
    AND access_expires_at <= access_issued_at + interval '15 minutes'
  ),
  CONSTRAINT session_refresh_after_access CHECK (
    refresh_expires_at > access_expires_at
  ),
  CONSTRAINT session_revoked_after_creation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX session_device_idx ON identity.session (device_id);

-- La fenêtre d'accès est ancrée sur l'horloge base, pas seulement sur un
-- horodatage fourni par l'application : une rotation ne peut pas repousser
-- l'expiration au-delà de vingt minutes réelles (cinq minutes de tolérance).
CREATE FUNCTION identity.anchor_session_window() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Une création datée du futur serait impossible à révoquer par now() :
  -- la base ramène l'horodatage à son horloge.
  IF TG_OP = 'INSERT' AND NEW.created_at > now() THEN
    NEW.created_at := now();
  END IF;
  IF NEW.access_issued_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: émission dans le futur';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.access_issued_at < OLD.access_issued_at THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: émission régressante';
  END IF;
  IF NEW.access_expires_at > now() + interval '16 minutes' THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: expiration hors fenêtre réelle';
  END IF;
  IF NEW.refresh_expires_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: rafraîchissement trop lointain';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.refresh_expires_at < OLD.refresh_expires_at THEN
    RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: rafraîchissement régressant';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER session_anchor
  BEFORE INSERT OR UPDATE ON identity.session
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_session_window();

CREATE TABLE identity.recovery (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL
    REFERENCES identity.account(id) ON DELETE RESTRICT,
  old_phone text NOT NULL CHECK (old_phone ~ '^\+[1-9][0-9]{7,14}$'),
  new_phone text NOT NULL CHECK (new_phone ~ '^\+[1-9][0-9]{7,14}$'),
  method text NOT NULL CHECK (method IN ('KYC_STRONG')),
  requested_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  had_balance boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  completed_at timestamptz,
  CONSTRAINT recovery_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT recovery_phones_differ CHECK (old_phone <> new_phone),
  CONSTRAINT recovery_available_after_request CHECK (
    available_at >= requested_at
  ),
  CONSTRAINT recovery_balance_delay CHECK (
    NOT had_balance
    OR available_at >= requested_at + interval '24 hours'
  ),
  CONSTRAINT recovery_completion_consistent CHECK (
    (status = 'COMPLETED'
      AND completed_at IS NOT NULL
      AND completed_at >= available_at)
    OR (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);

-- Le demandeur ne fixe ni la date de demande, ni le délai, ni l'état initial :
-- la base ancre la demande sur son horloge. Un compte avec solde impose 24 h.
CREATE FUNCTION identity.anchor_recovery_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.requested_at := now();
  NEW.available_at := now()
    + CASE WHEN NEW.had_balance THEN interval '24 hours' ELSE interval '0' END;
  NEW.status := 'PENDING';
  NEW.completed_at := NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER recovery_anchor
  BEFORE INSERT ON identity.recovery
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_recovery_request();

-- Un changement de numéro n'est licite que dans le cadre d'une récupération
-- terminée, tracée par identity.recovery.
CREATE FUNCTION identity.guard_account_phone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND NOT EXISTS (
    SELECT 1 FROM identity.recovery r
    WHERE r.account_id = OLD.id
      AND r.new_phone = NEW.phone
      AND r.status = 'COMPLETED'
      AND r.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: changement de numéro hors récupération';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_phone_guard
  BEFORE UPDATE ON identity.account
  FOR EACH ROW EXECUTE FUNCTION identity.guard_account_phone();

CREATE TABLE identity.transaction_signature (
  operation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL
    REFERENCES identity.account(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL
    REFERENCES identity.device(id) ON DELETE RESTRICT,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  nonce uuid NOT NULL UNIQUE,
  action text NOT NULL CHECK (
    action IN ('WITHDRAWAL', 'SETTLEMENT', 'REFUND', 'TRANSFER')
  ),
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  authorized_at timestamptz NOT NULL,
  pin_verified boolean NOT NULL DEFAULT true CHECK (pin_verified),
  CONSTRAINT transaction_uuid_v7 CHECK (
    substring(operation_id::text FROM 15 FOR 1) = '7'
    AND substring(operation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
    AND substring(nonce::text FROM 15 FOR 1) = '7'
    AND substring(nonce::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT transaction_ttl CHECK (
    expires_at > issued_at
    AND expires_at <= issued_at + interval '15 minutes'
  ),
  CONSTRAINT transaction_authorized_window CHECK (
    authorized_at >= issued_at AND authorized_at < expires_at
  )
);

CREATE INDEX transaction_device_idx
  ON identity.transaction_signature (device_id);

CREATE FUNCTION identity.protect_device() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: réactivation d’appareil interdite';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER device_no_reactivation
  BEFORE UPDATE ON identity.device
  FOR EACH ROW EXECUTE FUNCTION identity.protect_device();

CREATE FUNCTION identity.protect_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
     AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: session révoquée définitivement';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER session_no_unrevoke
  BEFORE UPDATE ON identity.session
  FOR EACH ROW EXECUTE FUNCTION identity.protect_session();

CREATE FUNCTION identity.protect_recovery() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'CANCELLED')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: récupération terminée';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recovery_terminal
  BEFORE UPDATE ON identity.recovery
  FOR EACH ROW EXECUTE FUNCTION identity.protect_recovery();

-- Chemin atomique de fin de récupération : vérifie la preuve OTP consommée,
-- le KYC renforcé et le délai, puis change le numéro et révoque appareils
-- et sessions dans la même transaction. Exécutable uniquement par app_rw.
CREATE FUNCTION identity.complete_recovery(
  p_recovery uuid,
  p_challenge uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target identity.recovery%ROWTYPE;
  current_phone text;
  current_kyc text;
  current_status text;
BEGIN
  SELECT * INTO target
  FROM identity.recovery
  WHERE id = p_recovery
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IDENTITY_RECOVERY_FORBIDDEN: demande inconnue';
  END IF;
  IF target.status <> 'PENDING' THEN
    RAISE EXCEPTION 'IDENTITY_RECOVERY_FORBIDDEN: demande déjà traitée';
  END IF;
  IF now() < target.available_at THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_NOT_DUE: délai de sécurité non écoulé';
  END IF;
  SELECT phone, kyc_level, status
  INTO current_phone, current_kyc, current_status
  FROM identity.account
  WHERE id = target.account_id
  FOR UPDATE;
  IF current_status <> 'ACTIVE' THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: compte bloqué';
  END IF;
  IF current_phone IS DISTINCT FROM target.old_phone THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: numéro du compte modifié depuis la demande';
  END IF;
  IF current_kyc <> 'STRONG' THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: vérification KYC renforcée exigée';
  END IF;
  -- Un numéro déjà attribué à un autre compte ne doit pas produire une
  -- violation d'unicité brute (23505) : le refus est explicite.
  IF EXISTS (
    SELECT 1
    FROM identity.account other
    WHERE other.phone = target.new_phone
      AND other.id <> target.account_id
  ) THEN
    RAISE EXCEPTION 'IDENTITY_RECOVERY_FORBIDDEN: numéro déjà attribué';
  END IF;
  IF p_challenge IS NULL OR NOT EXISTS (
    SELECT 1
    FROM identity.otp_challenge c
    WHERE c.id = p_challenge
      AND c.purpose = 'RECOVERY'
      AND c.binding = target.account_id::text
      AND c.phone = target.new_phone
      AND c.consumed_at IS NOT NULL
      AND c.consumed_at <= now()
      AND c.consumed_at >= now() - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: preuve OTP RECOVERY absente ou périmée';
  END IF;

  UPDATE identity.recovery
  SET status = 'COMPLETED', completed_at = now()
  WHERE id = p_recovery;

  UPDATE identity.account
  SET phone = target.new_phone, phone_verified_at = now()
  WHERE id = target.account_id;

  UPDATE identity.device
  SET status = 'REVOKED', revoked_at = now()
  WHERE account_id = target.account_id AND status = 'ACTIVE';

  UPDATE identity.session
  SET revoked_at = now()
  WHERE account_id = target.account_id AND revoked_at IS NULL;
END $$;

CREATE FUNCTION identity.cancel_recovery(p_recovery uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE identity.recovery
  SET status = 'CANCELLED'
  WHERE id = p_recovery AND status = 'PENDING';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: demande absente ou déjà traitée';
  END IF;
END $$;

CREATE FUNCTION identity.reject_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % interdit sur %', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER transaction_signature_append_only
  BEFORE UPDATE OR DELETE ON identity.transaction_signature
  FOR EACH ROW EXECUTE FUNCTION identity.reject_append_only();

-- La signature est horodatée par l'application, mais la base refuse tout
-- horodatage futur et toute validité hors de la fenêtre de quinze minutes.
CREATE FUNCTION identity.anchor_transaction_signature() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issued_at > now() OR NEW.authorized_at > now() THEN
    RAISE EXCEPTION 'IDENTITY_TRANSACTION_INVALID: horodatage futur';
  END IF;
  IF NEW.expires_at > now() + interval '16 minutes' THEN
    RAISE EXCEPTION 'IDENTITY_TRANSACTION_INVALID: expiration hors fenêtre';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_signature_anchor
  BEFORE INSERT ON identity.transaction_signature
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_transaction_signature();

GRANT USAGE ON SCHEMA identity TO app_rw, app_ro;
-- Un compte naît actif, non vérifié KYC : seules ces colonnes sont
-- insérables. Le niveau KYC ne s'attribue jamais depuis l'application.
GRANT SELECT ON identity.account TO app_rw;
GRANT INSERT (id, phone, phone_verified_at) ON identity.account TO app_rw;
GRANT UPDATE (status, blocked_at, block_channel, block_reason)
  ON identity.account TO app_rw;
GRANT SELECT ON identity.otp_challenge TO app_rw;
-- consumed_at n'est pas insérable : un défi ne peut pas naître consommé.
GRANT INSERT (
  id, phone, purpose, binding, code_hash, expires_at, attempts_remaining
) ON identity.otp_challenge TO app_rw;
GRANT UPDATE (attempts_remaining, consumed_at)
  ON identity.otp_challenge TO app_rw;
GRANT SELECT, INSERT ON identity.device TO app_rw;
GRANT UPDATE (status, revoked_at) ON identity.device TO app_rw;
GRANT SELECT, INSERT ON identity.pin_credential TO app_rw;
GRANT UPDATE (pin_hash, failed_attempts, lockouts, locked_until, updated_at)
  ON identity.pin_credential TO app_rw;
GRANT SELECT, INSERT ON identity.session TO app_rw;
GRANT UPDATE (
  access_token_hash, refresh_token_hash, access_issued_at,
  access_expires_at, refresh_expires_at, revoked_at
) ON identity.session TO app_rw;
-- requested_at, available_at, status et completed_at sont fixés par le
-- trigger d'ancrage, pas par l'appelant.
GRANT SELECT ON identity.recovery TO app_rw;
GRANT INSERT (id, account_id, old_phone, new_phone, method, had_balance)
  ON identity.recovery TO app_rw;
GRANT SELECT, INSERT ON identity.transaction_signature TO app_rw;

-- Les secrets hachés (OTP, PIN) ne sont pas lisibles par le rôle de lecture.
GRANT SELECT ON identity.account TO app_ro;
GRANT SELECT ON identity.device TO app_ro;
GRANT SELECT (
  id, account_id, device_id, access_expires_at, refresh_expires_at,
  created_at, revoked_at
) ON identity.session TO app_ro;
GRANT SELECT ON identity.recovery TO app_ro;
GRANT SELECT ON identity.transaction_signature TO app_ro;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.complete_recovery(uuid, uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION identity.cancel_recovery(uuid) TO app_rw;

COMMIT;
