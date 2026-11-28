-- Migration 0017 — clés d'idempotence des commandes HTTP (INT-IDEM-001).
-- L'unicité (portée, clé) est imposée par la base. L'enregistrement est écrit
-- dans la même transaction que la commande : il n'existe que si la commande a
-- réussi, et un rejeu renvoie la réponse d'origine. Une ligne reçoit sa
-- réponse une seule fois puis devient immuable ; aucune suppression.

BEGIN;

CREATE SCHEMA IF NOT EXISTS api;
REVOKE ALL ON SCHEMA api FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE api.idempotency_record (
  -- ASCII imprimable sans espace : plage « ! » (0x21) à « ~ » (0x7E).
  -- Les répétitions d'expression régulière PostgreSQL sont bornées à 255.
  scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 300 AND scope ~ '^[!-~]+$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{16,128}$'),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  response_status smallint CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 299),
  response_body jsonb,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT idempotency_completion_consistent CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE FUNCTION api.anchor_idempotency_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.response_status IS NOT NULL THEN
    RAISE EXCEPTION 'REQUEST_INVALID: une clé est créée sans réponse';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Seule mise à jour permise : poser la réponse une fois, rien d'autre.
CREATE FUNCTION api.guard_idempotency_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.response_status IS NOT NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: réponse déjà enregistrée';
  END IF;
  IF NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.response_status IS NULL THEN
    RAISE EXCEPTION 'REQUEST_INVALID: seule la réponse peut être enregistrée';
  END IF;
  NEW.completed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION api.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REQUEST_INVALID: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

REVOKE ALL ON FUNCTION api.anchor_idempotency_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION api.guard_idempotency_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION api.forbid_delete() FROM PUBLIC;

CREATE TRIGGER idempotency_record_anchor
  BEFORE INSERT ON api.idempotency_record
  FOR EACH ROW EXECUTE FUNCTION api.anchor_idempotency_record();
CREATE TRIGGER idempotency_record_guard
  BEFORE UPDATE ON api.idempotency_record
  FOR EACH ROW EXECUTE FUNCTION api.guard_idempotency_record();
CREATE TRIGGER idempotency_record_no_delete
  BEFORE DELETE ON api.idempotency_record
  FOR EACH ROW EXECUTE FUNCTION api.forbid_delete();
CREATE TRIGGER idempotency_record_no_truncate
  BEFORE TRUNCATE ON api.idempotency_record
  FOR EACH STATEMENT EXECUTE FUNCTION api.forbid_delete();

ALTER TABLE api.idempotency_record ENABLE ALWAYS TRIGGER idempotency_record_anchor;
ALTER TABLE api.idempotency_record ENABLE ALWAYS TRIGGER idempotency_record_guard;
ALTER TABLE api.idempotency_record ENABLE ALWAYS TRIGGER idempotency_record_no_delete;
ALTER TABLE api.idempotency_record ENABLE ALWAYS TRIGGER idempotency_record_no_truncate;

GRANT USAGE ON SCHEMA api TO app_rw, app_ro;
GRANT SELECT, INSERT ON api.idempotency_record TO app_rw;
GRANT UPDATE (response_status, response_body, completed_at) ON api.idempotency_record TO app_rw;
GRANT SELECT ON api.idempotency_record TO app_ro;
REVOKE DELETE, TRUNCATE ON api.idempotency_record FROM app_rw, app_ro;

COMMIT;
