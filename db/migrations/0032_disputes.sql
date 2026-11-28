-- Migration 0032 — réclamations et litiges (lot 15, tranche 1 : F-SUP-001/002).
-- Dépend de 0011/0015 (agreements).
--
-- Réclamation : numéro non séquentiel, canal en liste blanche, horodatage
-- serveur (accusé de réception). Aucun texte libre (D41).
-- Litige : ouvert sur une réclamation liée à un accord ; dans la même
-- transaction, l'accord passe à DISPUTED (suspension). La levée, par une
-- autre personne que l'ouverture (I-7), ramène l'accord à son état d'origine
-- dans la même transaction. `disputes` ne pose aucun déclencheur sur les
-- tables d'agreements : un DISPUTED sans litige est DÉTECTÉ, pas bloqué.
-- Issue « remboursement » : lot 12.

BEGIN;

CREATE SCHEMA IF NOT EXISTS disputes;
REVOKE ALL ON SCHEMA disputes FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE disputes.complaint (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE CHECK (reference ~ '^R-[0-9A-HJKMNP-TV-Z]{10}$'),
  customer_id uuid NOT NULL,
  agreement_id uuid NULL REFERENCES agreements.agreement (id),
  channel text NOT NULL CHECK (channel IN ('APP', 'USSD_CALLBACK', 'PHONE')),
  received_at timestamptz NOT NULL,
  CONSTRAINT complaint_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE INDEX complaint_agreement_idx ON disputes.complaint (agreement_id);

CREATE TABLE disputes.dispute (
  id uuid PRIMARY KEY,
  complaint_id uuid NOT NULL UNIQUE REFERENCES disputes.complaint (id),
  agreement_id uuid NOT NULL REFERENCES agreements.agreement (id),
  from_status text NOT NULL CHECK (from_status IN ('ACTIVE', 'FUNDED')),
  opened_by text NOT NULL CHECK (length(opened_by) BETWEEN 1 AND 200 AND opened_by !~ '[[:space:]]'),
  opened_at timestamptz NOT NULL,
  CONSTRAINT dispute_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE INDEX dispute_agreement_idx ON disputes.dispute (agreement_id);

CREATE TABLE disputes.dispute_resolution (
  dispute_id uuid PRIMARY KEY REFERENCES disputes.dispute (id),
  outcome text NOT NULL CHECK (outcome IN ('RESUMED')),
  resolved_by text NOT NULL CHECK (length(resolved_by) BETWEEN 1 AND 200 AND resolved_by !~ '[[:space:]]'),
  resolved_at timestamptz NOT NULL
);

CREATE FUNCTION disputes.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DISPUTE_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE FUNCTION disputes.anchor_complaint() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
BEGIN
  IF NEW.agreement_id IS NOT NULL THEN
    SELECT customer_id INTO owner FROM agreements.agreement WHERE id = NEW.agreement_id;
    IF owner IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'DISPUTE_INVALID_REQUEST: accord d’un autre client';
    END IF;
  END IF;
  NEW.received_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION disputes.anchor_dispute() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  complaint_agreement uuid;
BEGIN
  SELECT agreement_id INTO complaint_agreement
  FROM disputes.complaint WHERE id = NEW.complaint_id;
  IF complaint_agreement IS NULL OR complaint_agreement <> NEW.agreement_id THEN
    RAISE EXCEPTION 'DISPUTE_INVALID_REQUEST: la réclamation ne porte pas sur cet accord';
  END IF;
  -- Un seul litige ouvert par accord. Deux ouvertures concurrentes exigent
  -- chacune la transition vers DISPUTED au même rang de séquence : la clé
  -- primaire d'agreements.status_event n'en accepte qu'une.
  IF EXISTS (
    SELECT 1 FROM disputes.dispute d
    WHERE d.agreement_id = NEW.agreement_id
      AND NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)
  ) THEN
    RAISE EXCEPTION 'DISPUTE_ALREADY_OPEN: un litige est déjà ouvert sur cet accord';
  END IF;
  NEW.opened_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Suspension effective : à la validation, l'accord est DISPUTED depuis from_status.
CREATE FUNCTION disputes.assert_dispute_suspends() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_from text;
  last_to text;
BEGIN
  SELECT e.from_status, e.to_status INTO last_from, last_to
  FROM agreements.status_event e
  WHERE e.agreement_id = NEW.agreement_id AND e.kind = 'TRANSITION'
  ORDER BY e.seq DESC LIMIT 1;
  IF last_to IS DISTINCT FROM 'DISPUTED' OR last_from IS DISTINCT FROM NEW.from_status THEN
    RAISE EXCEPTION 'DISPUTE_SUSPENSION_INCOMPLETE: l’accord n’est pas passé à DISPUTED';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION disputes.anchor_resolution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  opener text;
BEGIN
  SELECT opened_by INTO opener FROM disputes.dispute WHERE id = NEW.dispute_id;
  IF opener = NEW.resolved_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: la levée exige une autre personne que l’ouverture';
  END IF;
  NEW.resolved_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Levée tracée : à la validation, l'accord est revenu à son état d'origine.
CREATE FUNCTION disputes.assert_resolution_resumes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origin text;
  agreement uuid;
  last_from text;
  last_to text;
BEGIN
  SELECT from_status, agreement_id INTO origin, agreement
  FROM disputes.dispute WHERE id = NEW.dispute_id;
  SELECT e.from_status, e.to_status INTO last_from, last_to
  FROM agreements.status_event e
  WHERE e.agreement_id = agreement AND e.kind = 'TRANSITION'
  ORDER BY e.seq DESC LIMIT 1;
  IF last_from IS DISTINCT FROM 'DISPUTED' OR last_to IS DISTINCT FROM origin THEN
    RAISE EXCEPTION 'DISPUTE_SUSPENSION_INCOMPLETE: l’accord n’est pas revenu à %', origin;
  END IF;
  RETURN NULL;
END $$;

-- Détection : accords DISPUTED sans litige ouvert.
CREATE FUNCTION disputes.disputed_without_dispute()
RETURNS TABLE (agreement_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT s.id
  FROM agreements.agreement_state s
  WHERE s.status = 'DISPUTED'
    AND NOT EXISTS (
      SELECT 1 FROM disputes.dispute d
      WHERE d.agreement_id = s.id
        AND NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)
    )
  ORDER BY s.id
$$;

REVOKE ALL ON FUNCTION disputes.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.anchor_complaint() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.anchor_dispute() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.assert_dispute_suspends() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.anchor_resolution() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.assert_resolution_resumes() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.disputed_without_dispute() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION disputes.disputed_without_dispute() TO app_rw, app_ro;

CREATE TRIGGER complaint_anchor BEFORE INSERT ON disputes.complaint
  FOR EACH ROW EXECUTE FUNCTION disputes.anchor_complaint();
CREATE TRIGGER dispute_anchor BEFORE INSERT ON disputes.dispute
  FOR EACH ROW EXECUTE FUNCTION disputes.anchor_dispute();
CREATE CONSTRAINT TRIGGER dispute_suspends AFTER INSERT ON disputes.dispute
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION disputes.assert_dispute_suspends();
CREATE TRIGGER resolution_anchor BEFORE INSERT ON disputes.dispute_resolution
  FOR EACH ROW EXECUTE FUNCTION disputes.anchor_resolution();
CREATE CONSTRAINT TRIGGER resolution_resumes AFTER INSERT ON disputes.dispute_resolution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION disputes.assert_resolution_resumes();

CREATE TRIGGER complaint_no_update_delete BEFORE UPDATE OR DELETE ON disputes.complaint
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER complaint_no_truncate BEFORE TRUNCATE ON disputes.complaint
  FOR EACH STATEMENT EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER dispute_no_update_delete BEFORE UPDATE OR DELETE ON disputes.dispute
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER dispute_no_truncate BEFORE TRUNCATE ON disputes.dispute
  FOR EACH STATEMENT EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER resolution_no_update_delete BEFORE UPDATE OR DELETE ON disputes.dispute_resolution
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER resolution_no_truncate BEFORE TRUNCATE ON disputes.dispute_resolution
  FOR EACH STATEMENT EXECUTE FUNCTION disputes.forbid_mutation();

ALTER TABLE disputes.complaint ENABLE ALWAYS TRIGGER complaint_anchor;
ALTER TABLE disputes.complaint ENABLE ALWAYS TRIGGER complaint_no_update_delete;
ALTER TABLE disputes.complaint ENABLE ALWAYS TRIGGER complaint_no_truncate;
ALTER TABLE disputes.dispute ENABLE ALWAYS TRIGGER dispute_anchor;
ALTER TABLE disputes.dispute ENABLE ALWAYS TRIGGER dispute_suspends;
ALTER TABLE disputes.dispute ENABLE ALWAYS TRIGGER dispute_no_update_delete;
ALTER TABLE disputes.dispute ENABLE ALWAYS TRIGGER dispute_no_truncate;
ALTER TABLE disputes.dispute_resolution ENABLE ALWAYS TRIGGER resolution_anchor;
ALTER TABLE disputes.dispute_resolution ENABLE ALWAYS TRIGGER resolution_resumes;
ALTER TABLE disputes.dispute_resolution ENABLE ALWAYS TRIGGER resolution_no_update_delete;
ALTER TABLE disputes.dispute_resolution ENABLE ALWAYS TRIGGER resolution_no_truncate;

GRANT USAGE ON SCHEMA disputes TO app_rw, app_ro;
GRANT SELECT, INSERT ON disputes.complaint, disputes.dispute, disputes.dispute_resolution TO app_rw;
GRANT SELECT ON disputes.complaint, disputes.dispute, disputes.dispute_resolution TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON disputes.complaint, disputes.dispute, disputes.dispute_resolution
  FROM app_rw, app_ro;

COMMIT;
