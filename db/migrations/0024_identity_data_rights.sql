-- F-ACC-005 partiel : réception et historique, sans exécution des droits.
BEGIN;
CREATE TABLE identity.data_right_request (
  id uuid PRIMARY KEY CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  account_id uuid NOT NULL REFERENCES identity.account(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES identity.session(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('ACCESS','RECTIFICATION','OBJECTION','ERASURE')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX data_right_request_history_idx ON identity.data_right_request(account_id, received_at DESC, id DESC);
CREATE FUNCTION identity.reject_data_right_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'DATA_RIGHTS_APPEND_ONLY: registre en ajout seul'; END $$;
CREATE TRIGGER data_right_request_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON identity.data_right_request
  FOR EACH STATEMENT EXECUTE FUNCTION identity.reject_data_right_mutation();
REVOKE ALL ON identity.data_right_request FROM PUBLIC,app_ro,app_rw;
CREATE FUNCTION identity.submit_data_right(p_account uuid,p_device uuid,p_session uuid,p_id uuid,p_kind text)
RETURNS TABLE(request_id uuid,kind text,received_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM identity.lock_security_actor(p_account,p_device,p_session);
  IF p_kind IS NULL OR p_kind NOT IN ('ACCESS','RECTIFICATION','OBJECTION','ERASURE') OR p_id IS NULL
    OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'REQUEST_INVALID: demande invalide'; END IF;
  RETURN QUERY INSERT INTO identity.data_right_request(id,account_id,session_id,kind)
    VALUES(p_id,p_account,p_session,p_kind) RETURNING id,data_right_request.kind,data_right_request.received_at;
END $$;
CREATE FUNCTION identity.list_data_rights(p_account uuid,p_device uuid,p_session uuid,p_before uuid)
RETURNS TABLE(request_id uuid,kind text,received_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cursor_time timestamptz;
BEGIN
  PERFORM identity.lock_security_actor(p_account,p_device,p_session);
  IF p_before IS NOT NULL THEN
    SELECT r.received_at INTO cursor_time FROM identity.data_right_request r WHERE r.id=p_before AND r.account_id=p_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_INVALID: curseur invalide'; END IF;
  END IF;
  -- 51e ligne interne pour savoir si la page publique de 50 a une suite.
  RETURN QUERY SELECT r.id,r.kind,r.received_at FROM identity.data_right_request r
    WHERE r.account_id=p_account AND (p_before IS NULL OR (r.received_at,r.id)<(cursor_time,p_before))
    ORDER BY r.received_at DESC,r.id DESC LIMIT 51;
END $$;
REVOKE ALL ON FUNCTION identity.submit_data_right(uuid,uuid,uuid,uuid,text),identity.list_data_rights(uuid,uuid,uuid,uuid),
  identity.reject_data_right_mutation() FROM PUBLIC,app_ro,app_rw;
GRANT EXECUTE ON FUNCTION identity.submit_data_right(uuid,uuid,uuid,uuid,text) TO app_rw;
GRANT EXECUTE ON FUNCTION identity.list_data_rights(uuid,uuid,uuid,uuid) TO app_rw,app_ro;
COMMIT;
