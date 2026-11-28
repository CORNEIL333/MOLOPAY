-- Migration 0041 — préparation et décision des règlements marchands
-- (lot 12 : F-SET-002, F-SET-003, CDC_05 § 5.4 PREPARED → APPROVED, D46).
-- Dépend de 0003 (admin), 0032 (disputes), 0040 (settlement.handover).
--
-- Préparation : un règlement par remise ; la base calcule le brut (prix
-- figé), la commission (arrondi au plus proche, demi-franc vers le haut, même
-- formule que packages/money mulDivRoundHalfUp) et le net, à partir des
-- paramètres versionnés « merchant_commission_bps » (0 à 10 000) et
-- « settlement_contestation_days » (0 à 60), fermés par défaut. Refus avant la
-- fin du délai de contestation et si une réclamation a été reçue depuis la remise.
-- Décision : par une autre personne que le préparateur (I-7) ; l'approbation
-- passe dans la même transaction l'écriture FEE_CHARGED débit 2200 du
-- marchand / crédit 7100 (CDC_04 § 2.2). Instruction signée et exécution :
-- tranche suivante (F-SET-004).

BEGIN;

CREATE TABLE settlement.payout (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL UNIQUE REFERENCES settlement.handover (agreement_id),
  partner_id text NOT NULL,
  gross_xaf bigint NOT NULL CHECK (gross_xaf > 0),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_xaf bigint NOT NULL CHECK (commission_xaf >= 0),
  net_xaf bigint NOT NULL CHECK (net_xaf >= 0),
  prepared_by text NOT NULL CHECK (length(prepared_by) BETWEEN 1 AND 200 AND prepared_by !~ '[[:space:]]'),
  prepared_at timestamptz NOT NULL,
  CONSTRAINT payout_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT payout_net CHECK (net_xaf = gross_xaf - commission_xaf)
);

CREATE TABLE settlement.payout_decision (
  payout_id uuid PRIMARY KEY REFERENCES settlement.payout (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  commission_entry_id uuid NULL UNIQUE REFERENCES ledger.journal_entry (id),
  decided_at timestamptz NOT NULL,
  CONSTRAINT payout_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL),
  CONSTRAINT payout_rejection_no_entry CHECK (decision <> 'REJECTED' OR commission_entry_id IS NULL)
);

-- Paramètre entier publié, borné ; NULL s'il est absent ou malformé.
CREATE FUNCTION settlement.integer_setting(p_key text, p_min integer, p_max integer)
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v jsonb;
  n integer;
BEGIN
  SELECT s.value INTO v FROM admin.setting_version s
  WHERE s.key = p_key ORDER BY s.version DESC LIMIT 1;
  IF v IS NULL OR jsonb_typeof(v) <> 'number' OR v::text !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;
  n := v::text::integer;
  IF n < p_min OR n > p_max THEN
    RETURN NULL;
  END IF;
  RETURN n;
END $$;

CREATE FUNCTION settlement.anchor_payout() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bps integer;
  window_days integer;
  handed_at timestamptz;
  handover_partner text;
  target bigint;
BEGIN
  bps := settlement.integer_setting('merchant_commission_bps', 0, 10000);
  window_days := settlement.integer_setting('settlement_contestation_days', 0, 60);
  IF bps IS NULL OR window_days IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_SETTINGS_NOT_CONFIGURED: commission ou délai de contestation non publiés';
  END IF;
  SELECT h.used_at, h.partner_id, a.target_xaf INTO handed_at, handover_partner, target
  FROM settlement.handover h
  JOIN agreements.agreement a ON a.id = h.agreement_id
  WHERE h.agreement_id = NEW.agreement_id;
  IF handed_at IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_INVALID_REQUEST: aucune remise pour cet accord';
  END IF;
  IF handed_at + make_interval(days => window_days) > clock_timestamp() THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_DUE: délai de contestation de % jours non écoulé', window_days;
  END IF;
  IF EXISTS (
    SELECT 1 FROM disputes.complaint c
    WHERE c.agreement_id = NEW.agreement_id AND c.received_at >= handed_at
  ) THEN
    RAISE EXCEPTION 'SETTLEMENT_BLOCKED: réclamation reçue depuis la remise';
  END IF;
  NEW.partner_id := handover_partner;
  NEW.gross_xaf := target;
  NEW.commission_bps := bps;
  NEW.commission_xaf := (target * bps * 2 + 10000) / 20000;
  NEW.net_xaf := target - NEW.commission_xaf;
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_payout_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  maker text;
  commission bigint;
  agreement uuid;
  partner text;
  partner_owner uuid;
  entry_type text;
  entry_payout text;
  line_count integer;
  partner_debit bigint;
  revenue_credit bigint;
BEGIN
  SELECT p.prepared_by, p.commission_xaf, p.agreement_id, p.partner_id
    INTO maker, commission, agreement, partner
  FROM settlement.payout p WHERE p.id = NEW.payout_id;
  IF maker = NEW.decided_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas décider';
  END IF;
  IF NEW.decision = 'APPROVED' THEN
    IF commission = 0 THEN
      IF NEW.commission_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: aucune commission à écrire';
      END IF;
    ELSE
      SELECT i.owner_id INTO partner_owner
      FROM catalog.partner_ledger_identity i WHERE i.partner_id = partner;
      SELECT e.operation_type, e.business_refs ->> 'payout_id' INTO entry_type, entry_payout
      FROM ledger.journal_entry e WHERE e.id = NEW.commission_entry_id;
      SELECT count(*),
             COALESCE(sum(p.amount_xaf) FILTER (
               WHERE p.direction = 'D' AND acc.code = '2200' AND acc.owner_type = 'PARTNER'
                 AND acc.owner_id = partner_owner), 0),
             COALESCE(sum(p.amount_xaf) FILTER (
               WHERE p.direction = 'C' AND acc.code = '7100' AND acc.owner_type IS NULL), 0)
        INTO line_count, partner_debit, revenue_credit
      FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
      WHERE p.entry_id = NEW.commission_entry_id;
      IF entry_type IS DISTINCT FROM 'FEE_CHARGED'
         OR entry_payout IS DISTINCT FROM NEW.payout_id::text
         OR line_count <> 2
         OR partner_debit <> commission
         OR revenue_credit <> commission THEN
        RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: écriture de commission absente ou non conforme';
      END IF;
    END IF;
  END IF;
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION settlement.integer_setting(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_payout() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_payout_decision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.integer_setting(text, integer, integer) TO app_rw, app_ro;

CREATE TRIGGER payout_anchor BEFORE INSERT ON settlement.payout
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_payout();
CREATE TRIGGER payout_decision_anchor BEFORE INSERT ON settlement.payout_decision
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_payout_decision();
CREATE TRIGGER payout_no_update_delete BEFORE UPDATE OR DELETE ON settlement.payout
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_no_truncate BEFORE TRUNCATE ON settlement.payout
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_decision_no_update_delete BEFORE UPDATE OR DELETE ON settlement.payout_decision
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_decision_no_truncate BEFORE TRUNCATE ON settlement.payout_decision
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();

ALTER TABLE settlement.payout ENABLE ALWAYS TRIGGER payout_anchor;
ALTER TABLE settlement.payout ENABLE ALWAYS TRIGGER payout_no_update_delete;
ALTER TABLE settlement.payout ENABLE ALWAYS TRIGGER payout_no_truncate;
ALTER TABLE settlement.payout_decision ENABLE ALWAYS TRIGGER payout_decision_anchor;
ALTER TABLE settlement.payout_decision ENABLE ALWAYS TRIGGER payout_decision_no_update_delete;
ALTER TABLE settlement.payout_decision ENABLE ALWAYS TRIGGER payout_decision_no_truncate;

GRANT SELECT, INSERT ON settlement.payout, settlement.payout_decision TO app_rw;
GRANT SELECT ON settlement.payout, settlement.payout_decision TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON settlement.payout, settlement.payout_decision FROM app_rw, app_ro;

COMMIT;
