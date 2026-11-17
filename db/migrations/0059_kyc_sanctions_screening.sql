-- Migration 0059 — filtrage contre la liste consolidée du Conseil de sécurité
-- de l'ONU (lot 07 : REG-LBC-002, D66). Schéma `kyc`, tout en ajout seul.
--
-- Une version de liste est importée en une transaction : son empreinte
-- SHA-256 est unique (un même fichier n'est jamais importé deux fois) et la
-- base vérifie à la validation que le nombre d'entrées annoncé est exact
-- (aucune liste tronquée). Un filtrage fige la version utilisée, le nom
-- examiné sous forme normalisée et les références rapprochées ; son issue est
-- dérivée (aucun rapprochement → CLEAR). Un rapprochement est examiné par la
-- conformité (une décision motivée par filtrage) ; rien n'est jamais modifié.

BEGIN;

CREATE SCHEMA IF NOT EXISTS kyc;
REVOKE ALL ON SCHEMA kyc FROM PUBLIC;
GRANT USAGE ON SCHEMA kyc TO app_rw, app_ro;

CREATE TABLE kyc.sanctions_list_version (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('UN_SC_CONSOLIDATED')),
  source_url text NOT NULL CHECK (length(source_url) <= 500 AND source_url ~ '^https://[A-Za-z0-9.-]+/[^[:space:]]+$'),
  generated_at timestamptz NOT NULL,
  content_sha256 bytea NOT NULL UNIQUE CHECK (octet_length(content_sha256) = 32),
  entry_count integer NOT NULL CHECK (entry_count BETWEEN 1 AND 100000),
  imported_by text NOT NULL CHECK (length(imported_by) BETWEEN 1 AND 200 AND imported_by !~ '[[:space:]]'),
  imported_at timestamptz NOT NULL,
  CONSTRAINT sanctions_list_version_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE TABLE kyc.sanctions_entry (
  version_id uuid NOT NULL REFERENCES kyc.sanctions_list_version (id),
  reference text NOT NULL CHECK (reference ~ '^[A-Za-z]{2}[ei]\.[0-9]{3,4}$'),
  kind text NOT NULL CHECK (kind IN ('INDIVIDUAL', 'ENTITY')),
  names text[] NOT NULL CHECK (cardinality(names) BETWEEN 1 AND 200),
  listed_on date NULL,
  PRIMARY KEY (version_id, reference)
);

CREATE TABLE kyc.screening (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('PARTNER', 'CUSTOMER')),
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200 AND subject_id !~ '[[:space:]]'),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 500),
  version_id uuid NOT NULL REFERENCES kyc.sanctions_list_version (id),
  matched_references text[] NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('CLEAR', 'POTENTIAL_MATCH')),
  screened_by text NOT NULL CHECK (length(screened_by) BETWEEN 1 AND 200 AND screened_by !~ '[[:space:]]'),
  screened_at timestamptz NOT NULL,
  CONSTRAINT screening_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT screening_outcome_derived CHECK ((outcome = 'CLEAR') = (cardinality(matched_references) = 0))
);
CREATE INDEX screening_subject_idx ON kyc.screening (subject_type, subject_id, screened_at DESC);

CREATE TABLE kyc.screening_review (
  screening_id uuid PRIMARY KEY REFERENCES kyc.screening (id),
  decision text NOT NULL CHECK (decision IN ('FALSE_POSITIVE', 'CONFIRMED_MATCH')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  reviewed_by text NOT NULL CHECK (length(reviewed_by) BETWEEN 1 AND 200 AND reviewed_by !~ '[[:space:]]'),
  reviewed_at timestamptz NOT NULL
);

CREATE FUNCTION kyc.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KYC_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE FUNCTION kyc.anchor_sanctions_list_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.imported_at := clock_timestamp();
  RETURN NEW;
END $$;

-- À la validation : le nombre d'entrées importées doit égaler le nombre annoncé.
CREATE FUNCTION kyc.assert_list_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  imported integer;
BEGIN
  SELECT count(*) INTO imported FROM kyc.sanctions_entry e WHERE e.version_id = NEW.id;
  IF imported <> NEW.entry_count THEN
    RAISE EXCEPTION 'KYC_LIST_INVALID: % entrées importées pour % annoncées', imported, NEW.entry_count;
  END IF;
  RETURN NULL;
END $$;

-- Les entrées ne s'ajoutent que dans la transaction qui crée la version (liste figée ensuite).
CREATE FUNCTION kyc.anchor_sanctions_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kyc.sanctions_list_version v WHERE v.id = NEW.version_id AND v.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'KYC_APPEND_ONLY: entrée ajoutée à une liste déjà validée';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION kyc.anchor_screening() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.matched_references) r
              WHERE NOT EXISTS (SELECT 1 FROM kyc.sanctions_entry e WHERE e.version_id = NEW.version_id AND e.reference = r)) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: référence rapprochée absente de la version de liste';
  END IF;
  NEW.screened_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION kyc.anchor_screening_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT outcome FROM kyc.screening WHERE id = NEW.screening_id) IS DISTINCT FROM 'POTENTIAL_MATCH' THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: seul un rapprochement s''examine';
  END IF;
  IF (SELECT screened_by FROM kyc.screening WHERE id = NEW.screening_id) = NEW.reviewed_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''auteur du filtrage ne peut pas l''examiner';
  END IF;
  NEW.reviewed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER sanctions_list_version_complete
  AFTER INSERT ON kyc.sanctions_list_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kyc.assert_list_complete();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sanctions_list_version', 'sanctions_entry', 'screening', 'screening_review'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION kyc.%I() FROM PUBLIC', 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON kyc.%I FOR EACH ROW EXECUTE FUNCTION kyc.%I()', t || '_anchor', t, 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON kyc.%I FOR EACH ROW EXECUTE FUNCTION kyc.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON kyc.%I FOR EACH STATEMENT EXECUTE FUNCTION kyc.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE kyc.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('ALTER TABLE kyc.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE kyc.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('GRANT SELECT, INSERT ON kyc.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON kyc.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON kyc.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;
ALTER TABLE kyc.sanctions_list_version ENABLE ALWAYS TRIGGER sanctions_list_version_complete;
REVOKE ALL ON FUNCTION kyc.assert_list_complete() FROM PUBLIC;
REVOKE ALL ON FUNCTION kyc.forbid_mutation() FROM PUBLIC;

COMMIT;
