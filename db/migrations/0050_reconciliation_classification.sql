-- Migration 0050 — classement des écarts de cantonnement en maker-checker
-- (lot 14 : INT-REC-003, INT-REC-004, I-7, D54). Dépend de 0030.
--
-- Une personne propose une classe (en transit, frais, doublon, inconnu) avec
-- son explication ; une autre la valide ou la refuse (motif). Un refus permet
-- une nouvelle proposition ; une proposition en attente ou validée bloque la
-- suivante. La colonne `incident.classification` de 0030 reste vide (table
-- en ajout seul) : la classe en vigueur est la proposition validée.
-- INT-REC-004 : un écart reste à escalader après 48 h tant qu'il n'a pas de
-- classe validée autre que « inconnu ». La correction par écriture de
-- régularisation passe par le circuit de contre-passation existant.

BEGIN;

CREATE TABLE reconciliation.classification_proposal (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES reconciliation.incident (id),
  classification text NOT NULL CHECK (classification IN ('IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN')),
  explanation text NOT NULL CHECK (length(btrim(explanation)) BETWEEN 1 AND 1000),
  proposed_by text NOT NULL CHECK (length(proposed_by) BETWEEN 1 AND 200 AND proposed_by !~ '[[:space:]]'),
  proposed_at timestamptz NOT NULL,
  CONSTRAINT classification_proposal_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);
CREATE INDEX classification_proposal_incident_idx ON reconciliation.classification_proposal (incident_id);

CREATE TABLE reconciliation.classification_decision (
  proposal_id uuid PRIMARY KEY REFERENCES reconciliation.classification_proposal (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  decided_at timestamptz NOT NULL,
  CONSTRAINT classification_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);

CREATE FUNCTION reconciliation.anchor_classification_proposal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reconciliation.classification:' || NEW.incident_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM reconciliation.classification_proposal p
    LEFT JOIN reconciliation.classification_decision d ON d.proposal_id = p.id
    WHERE p.incident_id = NEW.incident_id
      AND (d.proposal_id IS NULL OR d.decision = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'RECONCILIATION_ALREADY_CLASSIFIED: classement en attente ou validé pour cet écart';
  END IF;
  NEW.proposed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION reconciliation.anchor_classification_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT proposed_by FROM reconciliation.classification_proposal WHERE id = NEW.proposal_id) = NEW.decided_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: la validation exige une autre personne que la proposition';
  END IF;
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Classe validée en vigueur d'un écart (null si aucune).
CREATE FUNCTION reconciliation.approved_classification(p_incident uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT p.classification
  FROM reconciliation.classification_proposal p
  JOIN reconciliation.classification_decision d ON d.proposal_id = p.id AND d.decision = 'APPROVED'
  WHERE p.incident_id = p_incident
$$;

-- INT-REC-004 : écarts de plus de 48 h sans classe validée expliquée.
CREATE OR REPLACE FUNCTION reconciliation.incidents_to_escalate(p_at timestamptz)
RETURNS TABLE (id uuid, check_id uuid, gap_xaf bigint, opened_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.check_id, i.gap_xaf, i.opened_at
  FROM reconciliation.incident i
  WHERE COALESCE(reconciliation.approved_classification(i.id), 'UNKNOWN') = 'UNKNOWN'
    AND p_at - i.opened_at > interval '48 hours'
  ORDER BY i.opened_at
$$;

REVOKE ALL ON FUNCTION reconciliation.anchor_classification_proposal() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.anchor_classification_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.approved_classification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation.approved_classification(uuid) TO app_rw, app_ro;

CREATE TRIGGER classification_proposal_anchor BEFORE INSERT ON reconciliation.classification_proposal
  FOR EACH ROW EXECUTE FUNCTION reconciliation.anchor_classification_proposal();
CREATE TRIGGER classification_decision_anchor BEFORE INSERT ON reconciliation.classification_decision
  FOR EACH ROW EXECUTE FUNCTION reconciliation.anchor_classification_decision();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['classification_proposal', 'classification_decision'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON reconciliation.%I FOR EACH ROW EXECUTE FUNCTION reconciliation.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON reconciliation.%I FOR EACH STATEMENT EXECUTE FUNCTION reconciliation.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE reconciliation.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE reconciliation.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('ALTER TABLE reconciliation.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('GRANT SELECT, INSERT ON reconciliation.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON reconciliation.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON reconciliation.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;

COMMIT;
