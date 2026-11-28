-- 0004 est déjà appliquée. Le délai de 24 h et la fenêtre OTP de dix minutes
-- étaient comparés à now(), l'heure de début de transaction : une transaction
-- étirée avant l'INSERT pouvait raccourcir le délai de récupération, et une
-- preuve OTP ancienne restait acceptée dans une transaction longue. On ancre
-- sur clock_timestamp(), l'horloge murale du serveur, sans accepter d'heure
-- fournie par l'appelant.
BEGIN;

CREATE OR REPLACE FUNCTION identity.anchor_recovery_request() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  anchored_at timestamptz := clock_timestamp();
BEGIN
  NEW.requested_at := anchored_at;
  NEW.available_at := anchored_at
    + CASE WHEN NEW.had_balance THEN interval '24 hours' ELSE interval '0' END;
  NEW.status := 'PENDING';
  NEW.completed_at := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION identity.complete_recovery(
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
  checked_at timestamptz := clock_timestamp();
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
  IF checked_at < target.available_at THEN
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
      AND c.consumed_at <= checked_at
      AND c.consumed_at >= checked_at - interval '10 minutes'
  ) THEN
    RAISE EXCEPTION
      'IDENTITY_RECOVERY_FORBIDDEN: preuve OTP RECOVERY absente ou périmée';
  END IF;

  UPDATE identity.recovery
  SET status = 'COMPLETED', completed_at = checked_at
  WHERE id = p_recovery;

  UPDATE identity.account
  SET phone = target.new_phone, phone_verified_at = checked_at
  WHERE id = target.account_id;

  UPDATE identity.device
  SET status = 'REVOKED', revoked_at = checked_at
  WHERE account_id = target.account_id AND status = 'ACTIVE';

  UPDATE identity.session
  SET revoked_at = checked_at
  WHERE account_id = target.account_id AND revoked_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION identity.anchor_recovery_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.complete_recovery(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.complete_recovery(uuid, uuid) TO app_rw;

COMMIT;
