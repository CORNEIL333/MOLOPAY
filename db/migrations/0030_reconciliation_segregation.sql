-- Migration 0030 — contrôle de l'invariant de cantonnement (lot 14, tranche 1 :
-- INT-REC-002, INT-REC-004, I-8, I-9). Dépend de 0001 (ledger).
--
-- Un contrôle enregistre le solde du relevé du compte cantonné et les
-- règlements sortants en transit, saisis par la finance. Les fonds de tiers
-- (Σ 2100 + 2200 + 2300) et les encaissements en transit (1200) sont
-- CALCULÉS par la base à partir du grand livre : l'appelant ne peut pas les
-- affirmer. Tout écart différent de 0 FCFA ouvre un incident dans la même
-- transaction. Le classement des écarts (INT-REC-003) et leur correction par
-- écriture de régularisation (maker-checker) relèvent de la tranche suivante.

BEGIN;

CREATE SCHEMA IF NOT EXISTS reconciliation;
REVOKE ALL ON SCHEMA reconciliation FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE reconciliation.segregation_check (
  id uuid PRIMARY KEY,
  statement_date date NOT NULL,
  statement_balance_xaf bigint NOT NULL CHECK (statement_balance_xaf >= 0),
  outgoing_in_transit_xaf bigint NOT NULL CHECK (outgoing_in_transit_xaf >= 0),
  third_party_funds_xaf bigint NOT NULL,
  incoming_in_transit_xaf bigint NOT NULL,
  gap_xaf bigint NOT NULL,
  -- Dernière écriture prise en compte : rend le contrôle rejouable.
  ledger_seq bigint NOT NULL DEFAULT 0,
  actor_id text NOT NULL CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND actor_id !~ '[[:space:]]'
  ),
  checked_at timestamptz NOT NULL,
  CONSTRAINT segregation_check_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT segregation_check_gap CHECK (
    gap_xaf = statement_balance_xaf + incoming_in_transit_xaf
      - outgoing_in_transit_xaf - third_party_funds_xaf
  )
);

CREATE TABLE reconciliation.incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL UNIQUE REFERENCES reconciliation.segregation_check (id),
  gap_xaf bigint NOT NULL CHECK (gap_xaf <> 0),
  -- INT-REC-003 : classé plus tard, par circuit approuvé (tranche suivante).
  classification text NULL CHECK (classification IN ('IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN')),
  opened_at timestamptz NOT NULL
);

CREATE FUNCTION reconciliation.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RECONCILIATION_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- I-9 : totaux dérivés des écritures, sous le verrou de chaîne pour lire un
-- état cohérent du grand livre.
CREATE FUNCTION reconciliation.derive_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.lock_chain();
  SELECT
    COALESCE(sum(b.credit_total_xaf - b.debit_total_xaf)
      FILTER (WHERE b.code IN ('2100', '2200', '2300')), 0),
    COALESCE(sum(b.debit_total_xaf - b.credit_total_xaf)
      FILTER (WHERE b.code = '1200'), 0)
    INTO NEW.third_party_funds_xaf, NEW.incoming_in_transit_xaf
  FROM ledger.account_balance b;
  SELECT COALESCE(max(seq), 0) INTO NEW.ledger_seq FROM ledger.journal_entry;
  NEW.gap_xaf := NEW.statement_balance_xaf + NEW.incoming_in_transit_xaf
    - NEW.outgoing_in_transit_xaf - NEW.third_party_funds_xaf;
  NEW.checked_at := clock_timestamp();
  RETURN NEW;
END $$;

-- INT-REC-002 : tout écart non expliqué > 0 FCFA ouvre un incident.
CREATE FUNCTION reconciliation.open_incident() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gap_xaf <> 0 THEN
    INSERT INTO reconciliation.incident (check_id, gap_xaf, classification, opened_at)
    VALUES (NEW.id, NEW.gap_xaf, NULL, NEW.checked_at);
  END IF;
  RETURN NULL;
END $$;

-- INT-REC-004 : incidents non classés ouverts depuis plus de 48 h à l'instant donné.
CREATE FUNCTION reconciliation.incidents_to_escalate(p_at timestamptz)
RETURNS TABLE (id uuid, check_id uuid, gap_xaf bigint, opened_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.check_id, i.gap_xaf, i.opened_at
  FROM reconciliation.incident i
  WHERE i.classification IS NULL
    AND p_at - i.opened_at > interval '48 hours'
  ORDER BY i.opened_at
$$;

REVOKE ALL ON FUNCTION reconciliation.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.derive_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.open_incident() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.incidents_to_escalate(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation.incidents_to_escalate(timestamptz) TO app_rw, app_ro;

CREATE TRIGGER segregation_check_derive
  BEFORE INSERT ON reconciliation.segregation_check
  FOR EACH ROW EXECUTE FUNCTION reconciliation.derive_check();
CREATE TRIGGER segregation_check_incident
  AFTER INSERT ON reconciliation.segregation_check
  FOR EACH ROW EXECUTE FUNCTION reconciliation.open_incident();
CREATE TRIGGER segregation_check_no_update_delete
  BEFORE UPDATE OR DELETE ON reconciliation.segregation_check
  FOR EACH ROW EXECUTE FUNCTION reconciliation.forbid_mutation();
CREATE TRIGGER segregation_check_no_truncate
  BEFORE TRUNCATE ON reconciliation.segregation_check
  FOR EACH STATEMENT EXECUTE FUNCTION reconciliation.forbid_mutation();
CREATE TRIGGER incident_no_update_delete
  BEFORE UPDATE OR DELETE ON reconciliation.incident
  FOR EACH ROW EXECUTE FUNCTION reconciliation.forbid_mutation();
CREATE TRIGGER incident_no_truncate
  BEFORE TRUNCATE ON reconciliation.incident
  FOR EACH STATEMENT EXECUTE FUNCTION reconciliation.forbid_mutation();

ALTER TABLE reconciliation.segregation_check ENABLE ALWAYS TRIGGER segregation_check_derive;
ALTER TABLE reconciliation.segregation_check ENABLE ALWAYS TRIGGER segregation_check_incident;
ALTER TABLE reconciliation.segregation_check ENABLE ALWAYS TRIGGER segregation_check_no_update_delete;
ALTER TABLE reconciliation.segregation_check ENABLE ALWAYS TRIGGER segregation_check_no_truncate;
ALTER TABLE reconciliation.incident ENABLE ALWAYS TRIGGER incident_no_update_delete;
ALTER TABLE reconciliation.incident ENABLE ALWAYS TRIGGER incident_no_truncate;

GRANT USAGE ON SCHEMA reconciliation TO app_rw, app_ro;
GRANT SELECT, INSERT ON reconciliation.segregation_check, reconciliation.incident TO app_rw;
GRANT SELECT ON reconciliation.segregation_check, reconciliation.incident TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON reconciliation.segregation_check, reconciliation.incident
  FROM app_rw, app_ro;

COMMIT;
