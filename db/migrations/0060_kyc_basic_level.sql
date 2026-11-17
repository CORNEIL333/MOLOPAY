-- Migration 0060 — KYC niveau 1 (lot 07 : REG-LBC-001, REG-LBC-002,
-- F-ACC-003, D68). Dépend de 0004 (identity.account) et 0059 (kyc).
--
-- Le niveau 1 exige un numéro vérifié et un nom. Le client déclare son nom
-- légal (versions en ajout seul) ; le passage de NONE à BASIC n'est possible
-- que par `kyc.grant_basic_level`, qui vérifie en base : compte actif au
-- numéro vérifié, nom déclaré, et filtrage ONU rattaché à la dernière
-- déclaration (`kyc.legal_name_screening`), sans rapprochement ou avec un rapprochement écarté
-- par la Conformité. Aucune rétrogradation automatique ; le rôle applicatif
-- n'a toujours aucun droit de mise à jour sur `identity.account`.

BEGIN;

CREATE TABLE identity.legal_name_declaration (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.account (id) ON DELETE RESTRICT,
  legal_name text NOT NULL CHECK (
    length(legal_name) BETWEEN 2 AND 200 AND legal_name = btrim(legal_name) AND legal_name !~ '[[:cntrl:]]'
  ),
  declared_at timestamptz NOT NULL,
  CONSTRAINT legal_name_declaration_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);
CREATE INDEX legal_name_declaration_account_idx ON identity.legal_name_declaration (account_id, declared_at DESC);

CREATE FUNCTION identity.anchor_legal_name_declaration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM identity.account WHERE id = NEW.account_id) IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte bloqué ou inconnu';
  END IF;
  NEW.declared_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION identity.forbid_legal_name_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER legal_name_declaration_anchor BEFORE INSERT ON identity.legal_name_declaration
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_legal_name_declaration();
CREATE TRIGGER legal_name_declaration_no_update_delete BEFORE UPDATE OR DELETE ON identity.legal_name_declaration
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_legal_name_mutation();
CREATE TRIGGER legal_name_declaration_no_truncate BEFORE TRUNCATE ON identity.legal_name_declaration
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_legal_name_mutation();
ALTER TABLE identity.legal_name_declaration ENABLE ALWAYS TRIGGER legal_name_declaration_anchor;
ALTER TABLE identity.legal_name_declaration ENABLE ALWAYS TRIGGER legal_name_declaration_no_update_delete;
ALTER TABLE identity.legal_name_declaration ENABLE ALWAYS TRIGGER legal_name_declaration_no_truncate;
REVOKE ALL ON FUNCTION identity.anchor_legal_name_declaration() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.forbid_legal_name_mutation() FROM PUBLIC;
GRANT SELECT, INSERT ON identity.legal_name_declaration TO app_rw;
GRANT SELECT ON identity.legal_name_declaration TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON identity.legal_name_declaration FROM app_rw, app_ro;

-- Filtrage rattaché à une déclaration précise (même compte, filtrage postérieur).
CREATE TABLE kyc.legal_name_screening (
  declaration_id uuid PRIMARY KEY REFERENCES identity.legal_name_declaration (id),
  screening_id uuid NOT NULL UNIQUE REFERENCES kyc.screening (id)
);

CREATE FUNCTION kyc.anchor_legal_name_screening() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM kyc.screening s JOIN identity.legal_name_declaration d ON d.id = NEW.declaration_id
     WHERE s.id = NEW.screening_id AND s.subject_type = 'CUSTOMER' AND s.subject_id = d.account_id::text AND s.screened_at >= d.declared_at
  ) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: filtrage d''un autre client ou antérieur à la déclaration';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER legal_name_screening_anchor BEFORE INSERT ON kyc.legal_name_screening
  FOR EACH ROW EXECUTE FUNCTION kyc.anchor_legal_name_screening();
CREATE TRIGGER legal_name_screening_no_update_delete BEFORE UPDATE OR DELETE ON kyc.legal_name_screening
  FOR EACH ROW EXECUTE FUNCTION kyc.forbid_mutation();
CREATE TRIGGER legal_name_screening_no_truncate BEFORE TRUNCATE ON kyc.legal_name_screening
  FOR EACH STATEMENT EXECUTE FUNCTION kyc.forbid_mutation();
ALTER TABLE kyc.legal_name_screening ENABLE ALWAYS TRIGGER legal_name_screening_anchor;
ALTER TABLE kyc.legal_name_screening ENABLE ALWAYS TRIGGER legal_name_screening_no_update_delete;
ALTER TABLE kyc.legal_name_screening ENABLE ALWAYS TRIGGER legal_name_screening_no_truncate;
REVOKE ALL ON FUNCTION kyc.anchor_legal_name_screening() FROM PUBLIC;
GRANT SELECT, INSERT ON kyc.legal_name_screening TO app_rw;
GRANT SELECT ON kyc.legal_name_screening TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON kyc.legal_name_screening FROM app_rw, app_ro;

-- Seule voie d'élévation NONE → BASIC ; renvoie le niveau obtenu ou le motif de refus.
CREATE FUNCTION kyc.grant_basic_level(p_account uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  account_row record;
  latest_declaration record;
  latest record;
BEGIN
  SELECT status, kyc_level, phone_verified_at INTO account_row FROM identity.account WHERE id = p_account FOR UPDATE;
  IF NOT FOUND OR account_row.status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN 'ACCOUNT_NOT_ACTIVE';
  END IF;
  IF account_row.kyc_level <> 'NONE' THEN
    RETURN account_row.kyc_level;
  END IF;
  IF account_row.phone_verified_at IS NULL THEN
    RETURN 'PHONE_NOT_VERIFIED';
  END IF;
  SELECT d.id, d.declared_at INTO latest_declaration FROM identity.legal_name_declaration d
   WHERE d.account_id = p_account ORDER BY d.declared_at DESC, d.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'NAME_MISSING';
  END IF;
  -- Filtrage rattaché à la DERNIÈRE déclaration (le filtrage d'un autre nom ne compte pas).
  SELECT s.outcome, r.decision INTO latest
    FROM kyc.legal_name_screening l
    JOIN kyc.screening s ON s.id = l.screening_id
    LEFT JOIN kyc.screening_review r ON r.screening_id = s.id
   WHERE l.declaration_id = latest_declaration.id;
  IF NOT FOUND THEN
    RETURN 'SCREENING_MISSING';
  END IF;
  IF latest.outcome = 'POTENTIAL_MATCH' AND latest.decision IS DISTINCT FROM 'FALSE_POSITIVE' THEN
    RETURN CASE WHEN latest.decision IS NULL THEN 'SCREENING_PENDING_REVIEW' ELSE 'SCREENING_CONFIRMED_MATCH' END;
  END IF;
  UPDATE identity.account SET kyc_level = 'BASIC' WHERE id = p_account;
  RETURN 'BASIC';
END $$;

REVOKE ALL ON FUNCTION kyc.grant_basic_level(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyc.grant_basic_level(uuid) TO app_rw;

COMMIT;
