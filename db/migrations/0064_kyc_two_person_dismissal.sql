-- Migration 0064 — écartement d'un rapprochement client à deux personnes
-- (I-4, revue indépendante du 19 novembre ; I-7, SEC-AUTHZ-003, REG-LBC-002,
-- D68). Dépend de 0059 (kyc.screening_review) et 0063.
--
-- Le filtrage d'un nom déclaré par le client est enregistré par le système
-- (`kyc-self-declaration`) : la règle « auteur du filtrage ≠ examinateur »
-- ne mettait donc en jeu qu'une seule personne, qui pouvait seule écarter un
-- rapprochement et ouvrir le niveau 1. Désormais un « faux positif » client
-- exige une proposition motivée (`kyc.screening_review_proposal`) puis une
-- confirmation par une autre personne. Confirmer une correspondance (sens
-- restrictif) reste décidé par une personne. Tout en ajout seul.

BEGIN;

CREATE TABLE kyc.screening_review_proposal (
  screening_id uuid PRIMARY KEY REFERENCES kyc.screening (id),
  decision text NOT NULL CHECK (decision = 'FALSE_POSITIVE'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  proposed_by text NOT NULL CHECK (length(proposed_by) BETWEEN 1 AND 200 AND proposed_by !~ '[[:space:]]'),
  proposed_at timestamptz NOT NULL
);

CREATE FUNCTION kyc.anchor_screening_review_proposal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  screened record;
BEGIN
  SELECT s.outcome, s.subject_type, s.screened_by INTO screened FROM kyc.screening s WHERE s.id = NEW.screening_id;
  IF screened.outcome IS DISTINCT FROM 'POTENTIAL_MATCH' OR screened.subject_type IS DISTINCT FROM 'CUSTOMER' THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: seul l''écartement d''un rapprochement client se propose';
  END IF;
  IF screened.screened_by = NEW.proposed_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''auteur du filtrage ne peut pas proposer son écartement';
  END IF;
  IF EXISTS (SELECT 1 FROM kyc.screening_review r WHERE r.screening_id = NEW.screening_id) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: rapprochement déjà examiné';
  END IF;
  NEW.proposed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE TRIGGER screening_review_proposal_anchor BEFORE INSERT ON kyc.screening_review_proposal
  FOR EACH ROW EXECUTE FUNCTION kyc.anchor_screening_review_proposal();
CREATE TRIGGER screening_review_proposal_no_update_delete BEFORE UPDATE OR DELETE ON kyc.screening_review_proposal
  FOR EACH ROW EXECUTE FUNCTION kyc.forbid_mutation();
CREATE TRIGGER screening_review_proposal_no_truncate BEFORE TRUNCATE ON kyc.screening_review_proposal
  FOR EACH STATEMENT EXECUTE FUNCTION kyc.forbid_mutation();
ALTER TABLE kyc.screening_review_proposal ENABLE ALWAYS TRIGGER screening_review_proposal_anchor;
ALTER TABLE kyc.screening_review_proposal ENABLE ALWAYS TRIGGER screening_review_proposal_no_update_delete;
ALTER TABLE kyc.screening_review_proposal ENABLE ALWAYS TRIGGER screening_review_proposal_no_truncate;
REVOKE ALL ON FUNCTION kyc.anchor_screening_review_proposal() FROM PUBLIC;
GRANT SELECT, INSERT ON kyc.screening_review_proposal TO app_rw;
GRANT SELECT ON kyc.screening_review_proposal TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON kyc.screening_review_proposal FROM app_rw, app_ro;

-- Examen : règles de 0059, plus la confirmation par une seconde personne d'un faux positif client.
CREATE OR REPLACE FUNCTION kyc.anchor_screening_review() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  screened record;
  proposer text;
BEGIN
  SELECT s.outcome, s.subject_type, s.screened_by INTO screened FROM kyc.screening s WHERE s.id = NEW.screening_id;
  IF screened.outcome IS DISTINCT FROM 'POTENTIAL_MATCH' THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: seul un rapprochement s''examine';
  END IF;
  IF screened.screened_by = NEW.reviewed_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''auteur du filtrage ne peut pas l''examiner';
  END IF;
  IF NEW.decision = 'FALSE_POSITIVE' AND screened.subject_type = 'CUSTOMER' THEN
    SELECT p.proposed_by INTO proposer FROM kyc.screening_review_proposal p WHERE p.screening_id = NEW.screening_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KYC_INVALID_REQUEST: écartement d''un rapprochement client sans proposition préalable';
    END IF;
    IF proposer = NEW.reviewed_by THEN
      RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''auteur de la proposition ne peut pas la confirmer';
    END IF;
  END IF;
  NEW.reviewed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

COMMIT;
