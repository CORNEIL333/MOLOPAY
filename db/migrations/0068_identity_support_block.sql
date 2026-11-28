-- Migration 0068 — blocage d'un compte client par le support (C4, F-ACC-006).
-- Dépend de 0004 (identity) et 0023 (sécurité du compte).
--
-- Perte ou vol du téléphone : le support (ou le risque) bloque le compte sur
-- appel du client ou sur alerte. Comme le blocage depuis l'application
-- (0023), tout se fait dans une seule instruction de la base, sur son
-- horloge : compte BLOQUÉ (canal SUPPORT, motif saisi), appareils révoqués,
-- sessions fermées. Un compte déjà bloqué garde son motif d'origine. Le
-- déblocage passe par la récupération avec KYC renforcé (SEC-AUTH-007).

BEGIN;

CREATE FUNCTION identity.block_account_by_support(p_account uuid, p_reason text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  current_status text;
  instant timestamptz := clock_timestamp();
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'REQUEST_INVALID: motif de blocage invalide';
  END IF;
  SELECT a.status INTO current_status FROM identity.account a WHERE a.id = p_account FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_NOT_FOUND: compte client inconnu';
  END IF;
  IF current_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte déjà bloqué';
  END IF;
  UPDATE identity.account SET status = 'BLOCKED', blocked_at = instant, block_channel = 'SUPPORT', block_reason = btrim(p_reason) WHERE id = p_account;
  UPDATE identity.device SET status = 'REVOKED', revoked_at = instant WHERE account_id = p_account AND status = 'ACTIVE';
  UPDATE identity.session SET revoked_at = instant WHERE account_id = p_account AND revoked_at IS NULL;
  RETURN instant;
END $fn$;

REVOKE ALL ON FUNCTION identity.block_account_by_support(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.block_account_by_support(uuid, text) TO app_rw;

COMMIT;
