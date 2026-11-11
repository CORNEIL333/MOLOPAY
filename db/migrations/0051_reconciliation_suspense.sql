-- Migration 0051 — suspens 2900 en fin de mois (lot 14 : INT-REC-005, I-7,
-- D55). Dépend de 0001 et 0030.
--
-- À une date de clôture, le compte de suspens 2900 doit être soldé ; sinon
-- chaque écriture qui l'a mouvementé jusqu'à cette date doit être justifiée.
-- Une justification est proposée par une personne et validée par une autre
-- (I-7, vérifié ici) ; elle ne porte que sur une écriture ayant touché 2900.
-- Lecture : solde à la date et lignes encore non justifiées (vide si soldé).

BEGIN;

CREATE TABLE reconciliation.suspense_justification (
  entry_id uuid PRIMARY KEY REFERENCES ledger.journal_entry (id),
  explanation text NOT NULL CHECK (length(btrim(explanation)) BETWEEN 1 AND 1000),
  proposed_by text NOT NULL CHECK (length(proposed_by) BETWEEN 1 AND 200 AND proposed_by !~ '[[:space:]]'),
  proposed_at timestamptz NOT NULL
);

CREATE TABLE reconciliation.suspense_justification_approval (
  entry_id uuid PRIMARY KEY REFERENCES reconciliation.suspense_justification (entry_id),
  approved_by text NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 200 AND approved_by !~ '[[:space:]]'),
  approved_at timestamptz NOT NULL
);

CREATE FUNCTION reconciliation.anchor_suspense_justification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
    WHERE p.entry_id = NEW.entry_id AND a.code = '2900'
  ) THEN
    RAISE EXCEPTION 'RECONCILIATION_INVALID_REQUEST: écriture sans mouvement du suspens 2900';
  END IF;
  NEW.proposed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION reconciliation.anchor_suspense_justification_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT proposed_by FROM reconciliation.suspense_justification WHERE entry_id = NEW.entry_id) = NEW.approved_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: la validation exige une autre personne que la proposition';
  END IF;
  NEW.approved_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Solde du suspens (crédit − débit, passif) à la date donnée.
CREATE FUNCTION reconciliation.suspense_balance_at(p_at timestamptz) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(CASE p.direction WHEN 'C' THEN p.amount_xaf ELSE -p.amount_xaf END), 0)::bigint
  FROM ledger.posting p
  JOIN ledger.account a ON a.id = p.account_id AND a.code = '2900'
  JOIN ledger.journal_entry e ON e.id = p.entry_id
  WHERE e.recorded_at <= p_at
$$;

-- INT-REC-005 : lignes du suspens non justifiées à la clôture ; aucune si soldé.
CREATE FUNCTION reconciliation.unjustified_suspense_lines(p_at timestamptz)
RETURNS TABLE (entry_id uuid, seq bigint, recorded_at timestamptz, direction char(1), amount_xaf bigint)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.seq, e.recorded_at, p.direction, p.amount_xaf
  FROM ledger.posting p
  JOIN ledger.account a ON a.id = p.account_id AND a.code = '2900'
  JOIN ledger.journal_entry e ON e.id = p.entry_id
  WHERE e.recorded_at <= p_at
    AND reconciliation.suspense_balance_at(p_at) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM reconciliation.suspense_justification_approval x WHERE x.entry_id = e.id
    )
  ORDER BY e.seq
$$;

REVOKE ALL ON FUNCTION reconciliation.anchor_suspense_justification() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.anchor_suspense_justification_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.suspense_balance_at(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.unjustified_suspense_lines(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation.suspense_balance_at(timestamptz) TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION reconciliation.unjustified_suspense_lines(timestamptz) TO app_rw, app_ro;

CREATE TRIGGER suspense_justification_anchor BEFORE INSERT ON reconciliation.suspense_justification
  FOR EACH ROW EXECUTE FUNCTION reconciliation.anchor_suspense_justification();
CREATE TRIGGER suspense_justification_approval_anchor BEFORE INSERT ON reconciliation.suspense_justification_approval
  FOR EACH ROW EXECUTE FUNCTION reconciliation.anchor_suspense_justification_approval();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suspense_justification', 'suspense_justification_approval'] LOOP
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
