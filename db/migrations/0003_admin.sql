-- Migration 0003 — administration : RBAC, maker-checker, paramètres versionnés.
-- Exigences : F-BO-001, SEC-AUTHZ-001..005, INT-IDEM-003.
-- Le contrôle de rôle est applicatif (domaine admin) ; la base garantit
-- l'immuabilité, l'unicité de la décision et la séparation maker/checker.

BEGIN;

CREATE SCHEMA IF NOT EXISTS admin;
REVOKE ALL ON SCHEMA admin FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE admin.approval_request (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (
    'SETTLEMENT',
    'REFUND',
    'LEDGER_REVERSAL',
    'FINANCIAL_SETTING',
    'PARTNER_APPROVAL',
    'ROLE_GRANT',
    'BREAK_GLASS'
  )),
  maker_id text NOT NULL CHECK (length(btrim(maker_id)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  prepared_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_expiry_after_preparation CHECK (expires_at > prepared_at),
  CONSTRAINT request_break_glass_max_two_hours CHECK (
    kind <> 'BREAK_GLASS' OR expires_at <= prepared_at + interval '2 hours'
  )
);

CREATE INDEX approval_request_kind_idx ON admin.approval_request (kind, prepared_at DESC);
CREATE INDEX approval_request_maker_idx ON admin.approval_request (maker_id, prepared_at DESC);
CREATE INDEX approval_request_expiry_idx ON admin.approval_request (expires_at);

CREATE TABLE admin.approval_decision (
  request_id uuid PRIMARY KEY REFERENCES admin.approval_request (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'CANCELLED')),
  decided_by text NOT NULL CHECK (length(btrim(decided_by)) > 0),
  decided_at timestamptz NOT NULL,
  decision_reason text NULL CHECK (
    decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 1000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_rejection_reason_required CHECK (
    decision <> 'REJECTED' OR decision_reason IS NOT NULL
  )
);

-- Une demande ne peut être décidée qu'une fois, avant expiration, et jamais
-- par son préparateur (sauf annulation par ce dernier).
CREATE FUNCTION admin.assert_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_maker text;
  request_expires timestamptz;
BEGIN
  SELECT maker_id, expires_at INTO request_maker, request_expires
  FROM admin.approval_request
  WHERE id = NEW.request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: demande % absente', NEW.request_id;
  END IF;
  IF NEW.decided_at >= request_expires THEN
    RAISE EXCEPTION 'ADMIN_REQUEST_EXPIRED: demande % expirée', NEW.request_id;
  END IF;
  IF NEW.decision = 'CANCELLED' THEN
    IF NEW.decided_by <> request_maker THEN
      RAISE EXCEPTION 'ADMIN_FORBIDDEN: annulation réservée au préparateur';
    END IF;
  ELSE
    IF NEW.decided_by = request_maker THEN
      RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas décider';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE admin.setting_version (
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  version integer NOT NULL CHECK (version >= 1),
  value jsonb NOT NULL,
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  approval_request_id uuid NOT NULL UNIQUE
    REFERENCES admin.approval_request (id),
  PRIMARY KEY (key, version)
);

CREATE FUNCTION admin.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER approval_decision_verify
  BEFORE INSERT ON admin.approval_decision
  FOR EACH ROW EXECUTE FUNCTION admin.assert_decision();

CREATE TRIGGER approval_request_no_update_delete
  BEFORE UPDATE OR DELETE ON admin.approval_request
  FOR EACH ROW EXECUTE FUNCTION admin.forbid_mutation();
CREATE TRIGGER approval_request_no_truncate
  BEFORE TRUNCATE ON admin.approval_request
  FOR EACH STATEMENT EXECUTE FUNCTION admin.forbid_mutation();
CREATE TRIGGER approval_decision_no_update_delete
  BEFORE UPDATE OR DELETE ON admin.approval_decision
  FOR EACH ROW EXECUTE FUNCTION admin.forbid_mutation();
CREATE TRIGGER approval_decision_no_truncate
  BEFORE TRUNCATE ON admin.approval_decision
  FOR EACH STATEMENT EXECUTE FUNCTION admin.forbid_mutation();
CREATE TRIGGER setting_version_no_update_delete
  BEFORE UPDATE OR DELETE ON admin.setting_version
  FOR EACH ROW EXECUTE FUNCTION admin.forbid_mutation();
CREATE TRIGGER setting_version_no_truncate
  BEFORE TRUNCATE ON admin.setting_version
  FOR EACH STATEMENT EXECUTE FUNCTION admin.forbid_mutation();

ALTER TABLE admin.approval_request ENABLE ALWAYS TRIGGER approval_request_no_update_delete;
ALTER TABLE admin.approval_request ENABLE ALWAYS TRIGGER approval_request_no_truncate;
ALTER TABLE admin.approval_decision ENABLE ALWAYS TRIGGER approval_decision_verify;
ALTER TABLE admin.approval_decision ENABLE ALWAYS TRIGGER approval_decision_no_update_delete;
ALTER TABLE admin.approval_decision ENABLE ALWAYS TRIGGER approval_decision_no_truncate;
ALTER TABLE admin.setting_version ENABLE ALWAYS TRIGGER setting_version_no_update_delete;
ALTER TABLE admin.setting_version ENABLE ALWAYS TRIGGER setting_version_no_truncate;

-- État dérivé : PENDING, APPROVED, REJECTED, CANCELLED ou EXPIRED.
CREATE VIEW admin.approval_request_state
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.kind,
  r.maker_id,
  r.payload,
  r.payload_hash,
  r.reason,
  r.prepared_at,
  r.expires_at,
  CASE
    WHEN d.decision IS NOT NULL THEN d.decision
    WHEN r.expires_at <= now() THEN 'EXPIRED'
    ELSE 'PENDING'
  END AS status,
  d.decided_by,
  d.decided_at,
  d.decision_reason
FROM admin.approval_request r
LEFT JOIN admin.approval_decision d ON d.request_id = r.id;

GRANT USAGE ON SCHEMA admin TO app_rw, app_ro;
GRANT SELECT, INSERT ON admin.approval_request, admin.approval_decision, admin.setting_version TO app_rw;
GRANT SELECT ON admin.approval_request, admin.approval_decision, admin.setting_version TO app_ro;
GRANT SELECT ON admin.approval_request_state TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON admin.approval_request, admin.approval_decision, admin.setting_version FROM app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON admin.approval_request, admin.approval_decision, admin.setting_version FROM app_ro;
REVOKE CREATE ON SCHEMA admin FROM PUBLIC;

COMMIT;
