-- SEC-AUTH-005 / F-ACC-006 partiel : commandes de sécurité, sans déblocage.
BEGIN;
REVOKE UPDATE (status, blocked_at, block_channel, block_reason) ON identity.account FROM app_rw;
CREATE FUNCTION identity.lock_security_actor(p_account uuid, p_device uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE session_row identity.session%ROWTYPE; account_status text; device_status text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: isolation non prise en charge';
  END IF;
  IF p_account IS NULL OR p_device IS NULL OR p_session IS NULL OR NOT EXISTS (
    SELECT 1 FROM identity.session s WHERE s.id=p_session AND s.account_id=p_account AND s.device_id=p_device
  ) THEN RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: contexte de session invalide'; END IF;
  -- Ordre commun à toutes les commandes : compte, appareil, session.
  SELECT status INTO account_status FROM identity.account WHERE id=p_account FOR UPDATE;
  SELECT status INTO device_status FROM identity.device WHERE id=p_device AND account_id=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: contexte de session invalide'; END IF;
  SELECT * INTO session_row FROM identity.session WHERE id=p_session AND account_id=p_account AND device_id=p_device FOR UPDATE;
  IF NOT FOUND OR session_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'IDENTITY_SESSION_INVALID: contexte de session invalide'; END IF;
  IF session_row.access_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'IDENTITY_SESSION_EXPIRED: session expirée'; END IF;
  IF account_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte bloqué'; END IF;
  IF device_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'IDENTITY_DEVICE_REVOKED: appareil révoqué'; END IF;
END $$;
CREATE FUNCTION identity.apply_security_action(p_account uuid, p_device uuid, p_session uuid, p_action text)
RETURNS TABLE (affected_sessions integer, occurred_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE instant timestamptz; affected integer;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('REVOKE_OTHERS','SIGN_OUT','BLOCK') THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: commande inconnue';
  END IF;
  PERFORM identity.lock_security_actor(p_account,p_device,p_session);
  instant := clock_timestamp();
  IF p_action = 'BLOCK' THEN
    UPDATE identity.account SET status='BLOCKED',blocked_at=instant,block_channel='APP',block_reason='LOST_OR_STOLEN' WHERE id=p_account;
    UPDATE identity.device SET status='REVOKED',revoked_at=instant WHERE account_id=p_account AND status='ACTIVE';
    UPDATE identity.session SET revoked_at=instant WHERE account_id=p_account AND revoked_at IS NULL;
  ELSIF p_action = 'SIGN_OUT' THEN
    UPDATE identity.session SET revoked_at=instant WHERE id=p_session AND account_id=p_account AND revoked_at IS NULL;
  ELSE
    UPDATE identity.session SET revoked_at=instant WHERE account_id=p_account AND id<>p_session
      AND revoked_at IS NULL AND refresh_expires_at>instant;
  END IF;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN QUERY SELECT affected, instant;
END $$;
REVOKE ALL ON FUNCTION identity.lock_security_actor(uuid,uuid,uuid), identity.apply_security_action(uuid,uuid,uuid,text) FROM PUBLIC, app_ro;
GRANT EXECUTE ON FUNCTION identity.lock_security_actor(uuid,uuid,uuid), identity.apply_security_action(uuid,uuid,uuid,text) TO app_rw;
COMMIT;
