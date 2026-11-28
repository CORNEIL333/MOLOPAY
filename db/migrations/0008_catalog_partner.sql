-- Migration 0008 — catalogue : dossiers partenaires versionnés et validation
-- maker-checker (F-PRT-001, F-PRT-002, SEC-AUTHZ-003).
-- Dépend de 0003 et 0006 (admin.approval_request / approval_decision).
-- Aucune pièce n'est stockée : uniquement des références opaques.
-- L'empreinte du dossier (JCS + SHA-256) est calculée par l'application ;
-- la base vérifie qu'elle correspond à celle portée par la décision approuvée.

BEGIN;

CREATE SCHEMA IF NOT EXISTS catalog;
REVOKE ALL ON SCHEMA catalog FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE catalog.partner_dossier (
  partner_id text NOT NULL
    CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  version integer NOT NULL CHECK (version >= 1),
  legal_name text NOT NULL CHECK (
    length(legal_name) BETWEEN 1 AND 200 AND legal_name = btrim(legal_name)
  ),
  rccm text NOT NULL CHECK (rccm ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,199}$'),
  niu text NOT NULL CHECK (niu ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,199}$'),
  representative_document_ref text NOT NULL
    CHECK (representative_document_ref ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,199}$'),
  settlement_account_ref text NOT NULL
    CHECK (settlement_account_ref ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,199}$'),
  dossier_hash bytea NOT NULL CHECK (octet_length(dossier_hash) = 32),
  created_by text NOT NULL CHECK (
    length(created_by) BETWEEN 1 AND 200 AND created_by !~ '[[:space:]]'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (partner_id, version)
);

CREATE TABLE catalog.partner_validation (
  partner_id text NOT NULL,
  dossier_version integer NOT NULL,
  approval_request_id uuid NOT NULL UNIQUE
    REFERENCES admin.approval_request (id),
  validated_at timestamptz NOT NULL,
  PRIMARY KEY (partner_id, dossier_version),
  FOREIGN KEY (partner_id, dossier_version)
    REFERENCES catalog.partner_dossier (partner_id, version)
);

CREATE FUNCTION catalog.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CATALOG_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- Versions sans trou et horodatage sur l'horloge murale du serveur.
CREATE FUNCTION catalog.anchor_partner_dossier() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
BEGIN
  SELECT max(version) INTO latest
  FROM catalog.partner_dossier
  WHERE partner_id = NEW.partner_id;
  IF NEW.version <> COALESCE(latest, 0) + 1 THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: version % attendue, % reçue',
      COALESCE(latest, 0) + 1, NEW.version;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- La validation reprend exactement le partenaire et l'empreinte du dossier
-- courant portés par une demande PARTNER_APPROVAL approuvée par un tiers.
CREATE FUNCTION catalog.assert_partner_validation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_hash bytea;
  latest integer;
  request_kind text;
  request_payload jsonb;
  request_maker text;
  request_decision text;
  request_checker text;
  payload_keys text[];
BEGIN
  SELECT dossier_hash INTO current_hash
  FROM catalog.partner_dossier
  WHERE partner_id = NEW.partner_id AND version = NEW.dossier_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: dossier % v% absent',
      NEW.partner_id, NEW.dossier_version;
  END IF;
  SELECT max(version) INTO latest
  FROM catalog.partner_dossier
  WHERE partner_id = NEW.partner_id;
  IF NEW.dossier_version <> latest THEN
    RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: dossier remplacé par la version %', latest;
  END IF;

  SELECT r.kind, r.payload, r.maker_id, d.decision, d.decided_by
    INTO request_kind, request_payload, request_maker, request_decision, request_checker
  FROM admin.approval_request r
  LEFT JOIN admin.approval_decision d ON d.request_id = r.id
  WHERE r.id = NEW.approval_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: demande % absente', NEW.approval_request_id;
  END IF;
  IF request_kind <> 'PARTNER_APPROVAL'
     OR request_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: demande % non approuvée', NEW.approval_request_id;
  END IF;
  IF request_checker = request_maker THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas approuver';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO payload_keys
  FROM jsonb_object_keys(request_payload) AS k;
  IF payload_keys IS DISTINCT FROM ARRAY['dossier_hash', 'partner_id']::text[] THEN
    RAISE EXCEPTION 'CATALOG_FIELD_FORBIDDEN: charge approuvée hors liste blanche';
  END IF;
  IF request_payload->>'partner_id' IS DISTINCT FROM NEW.partner_id
     OR request_payload->>'dossier_hash' IS DISTINCT FROM encode(current_hash, 'hex') THEN
    RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: l''approbation ne porte pas sur ce dossier';
  END IF;

  NEW.validated_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.anchor_partner_dossier() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.assert_partner_validation() FROM PUBLIC;

CREATE TRIGGER partner_dossier_anchor
  BEFORE INSERT ON catalog.partner_dossier
  FOR EACH ROW EXECUTE FUNCTION catalog.anchor_partner_dossier();
CREATE TRIGGER partner_validation_verify
  BEFORE INSERT ON catalog.partner_validation
  FOR EACH ROW EXECUTE FUNCTION catalog.assert_partner_validation();
CREATE TRIGGER partner_dossier_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.partner_dossier
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER partner_dossier_no_truncate
  BEFORE TRUNCATE ON catalog.partner_dossier
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER partner_validation_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.partner_validation
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER partner_validation_no_truncate
  BEFORE TRUNCATE ON catalog.partner_validation
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();

ALTER TABLE catalog.partner_dossier ENABLE ALWAYS TRIGGER partner_dossier_anchor;
ALTER TABLE catalog.partner_dossier ENABLE ALWAYS TRIGGER partner_dossier_no_update_delete;
ALTER TABLE catalog.partner_dossier ENABLE ALWAYS TRIGGER partner_dossier_no_truncate;
ALTER TABLE catalog.partner_validation ENABLE ALWAYS TRIGGER partner_validation_verify;
ALTER TABLE catalog.partner_validation ENABLE ALWAYS TRIGGER partner_validation_no_update_delete;
ALTER TABLE catalog.partner_validation ENABLE ALWAYS TRIGGER partner_validation_no_truncate;

-- Statut dérivé du dossier courant : un dossier modifié après validation
-- repasse PENDING (invisible du catalogue) jusqu'à une nouvelle approbation.
CREATE VIEW catalog.partner_state
WITH (security_invoker = true) AS
SELECT
  d.partner_id,
  d.version AS dossier_version,
  CASE WHEN v.partner_id IS NULL THEN 'PENDING' ELSE 'VALIDATED' END AS status,
  v.approval_request_id,
  v.validated_at
FROM catalog.partner_dossier d
LEFT JOIN catalog.partner_validation v
  ON v.partner_id = d.partner_id AND v.dossier_version = d.version
WHERE d.version = (
  SELECT max(x.version) FROM catalog.partner_dossier x
  WHERE x.partner_id = d.partner_id
);

GRANT USAGE ON SCHEMA catalog TO app_rw, app_ro;
GRANT SELECT, INSERT ON catalog.partner_dossier, catalog.partner_validation TO app_rw;
GRANT SELECT ON catalog.partner_dossier, catalog.partner_validation TO app_ro;
GRANT SELECT ON catalog.partner_state TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON catalog.partner_dossier, catalog.partner_validation FROM app_rw, app_ro;
REVOKE CREATE ON SCHEMA catalog FROM PUBLIC;

COMMIT;
