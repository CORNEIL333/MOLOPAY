-- Migration 0042 — instruction signée et exécution des règlements
-- (lot 12 : F-SET-004, CDC_05 § 5.4 APPROVED → INSTRUCTED → EXECUTED | REJECTED,
-- INT-NR-002). Dépend de 0041.
--
-- Instruction : document canonique {domain, payout_id, partner_id, net_xaf}
-- signé en Ed25519 par la clé de la plateforme (vérification par
-- l'application et par le vérificateur : PostgreSQL n'a pas Ed25519). La base
-- exige que le document reprenne exactement le règlement approuvé.
-- Exécution : confirmée par une autre personne que l'émetteur (I-7), avec la
-- référence de l'établissement ; EXECUTED passe dans la même transaction
-- l'écriture SETTLEMENT_SENT débit 2200 du marchand / crédit 1100 (fonds
-- sortis du compte cantonné) ; REJECTED n'écrit rien (le net reste dû).
-- Toute instruction non confirmée sous 24 h est listée pour alerte.

BEGIN;

CREATE TABLE settlement.payout_instruction (
  payout_id uuid PRIMARY KEY REFERENCES settlement.payout (id),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  document_hash bytea NOT NULL CHECK (octet_length(document_hash) = 32),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 100 AND key_id !~ '[[:space:]]'),
  instructed_by text NOT NULL CHECK (length(instructed_by) BETWEEN 1 AND 200 AND instructed_by !~ '[[:space:]]'),
  instructed_at timestamptz NOT NULL
);

CREATE TABLE settlement.payout_execution (
  payout_id uuid PRIMARY KEY REFERENCES settlement.payout_instruction (payout_id),
  outcome text NOT NULL CHECK (outcome IN ('EXECUTED', 'REJECTED')),
  bank_reference text NOT NULL CHECK (bank_reference ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  entry_id uuid NULL UNIQUE REFERENCES ledger.journal_entry (id),
  recorded_by text NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 200 AND recorded_by !~ '[[:space:]]'),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT payout_execution_rejected_no_entry CHECK (outcome <> 'REJECTED' OR entry_id IS NULL)
);

CREATE FUNCTION settlement.anchor_payout_instruction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payout_decision text;
  payout_partner text;
  payout_net bigint;
  doc_keys text[];
BEGIN
  SELECT d.decision, p.partner_id, p.net_xaf INTO payout_decision, payout_partner, payout_net
  FROM settlement.payout p
  LEFT JOIN settlement.payout_decision d ON d.payout_id = p.id
  WHERE p.id = NEW.payout_id;
  IF payout_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_APPROVED: règlement non approuvé';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO doc_keys FROM jsonb_object_keys(NEW.document) AS k;
  IF doc_keys IS DISTINCT FROM ARRAY['domain', 'net_xaf', 'partner_id', 'payout_id']::text[]
     OR NEW.document->>'domain' IS DISTINCT FROM 'payout-instruction-v1'
     OR NEW.document->>'payout_id' IS DISTINCT FROM NEW.payout_id::text
     OR NEW.document->>'partner_id' IS DISTINCT FROM payout_partner
     OR NEW.document->>'net_xaf' IS DISTINCT FROM payout_net::text THEN
    RAISE EXCEPTION 'SETTLEMENT_INSTRUCTION_MISMATCH: instruction différente du règlement approuvé';
  END IF;
  NEW.instructed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_payout_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  instructor text;
  payout_partner text;
  payout_net bigint;
  partner_owner uuid;
  entry_type text;
  entry_payout text;
  line_count integer;
  partner_debit bigint;
  treasury_credit bigint;
BEGIN
  SELECT i.instructed_by, p.partner_id, p.net_xaf INTO instructor, payout_partner, payout_net
  FROM settlement.payout_instruction i
  JOIN settlement.payout p ON p.id = i.payout_id
  WHERE i.payout_id = NEW.payout_id;
  IF instructor = NEW.recorded_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''émetteur ne confirme pas son instruction';
  END IF;
  IF NEW.outcome = 'EXECUTED' THEN
    SELECT owner_id INTO partner_owner
    FROM catalog.partner_ledger_identity WHERE partner_id = payout_partner;
    SELECT e.operation_type, e.business_refs ->> 'payout_id' INTO entry_type, entry_payout
    FROM ledger.journal_entry e WHERE e.id = NEW.entry_id;
    SELECT count(*),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'D' AND acc.code = '2200' AND acc.owner_type = 'PARTNER'
               AND acc.owner_id = partner_owner), 0),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'C' AND acc.code = '1100' AND acc.owner_type IS NULL), 0)
      INTO line_count, partner_debit, treasury_credit
    FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
    WHERE p.entry_id = NEW.entry_id;
    IF entry_type IS DISTINCT FROM 'SETTLEMENT_SENT'
       OR entry_payout IS DISTINCT FROM NEW.payout_id::text
       OR line_count <> 2
       OR partner_debit <> payout_net
       OR treasury_credit <> payout_net THEN
      RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: écriture de règlement absente ou non conforme';
    END IF;
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;

-- F-SET-004 : instructions sans exécution enregistrée depuis plus de 24 h à `p_at`.
CREATE FUNCTION settlement.overdue_instructions(p_at timestamptz)
RETURNS TABLE (payout_id uuid, instructed_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT i.payout_id, i.instructed_at
  FROM settlement.payout_instruction i
  WHERE NOT EXISTS (SELECT 1 FROM settlement.payout_execution x WHERE x.payout_id = i.payout_id)
    AND p_at - i.instructed_at > interval '24 hours'
  ORDER BY i.instructed_at
$$;

REVOKE ALL ON FUNCTION settlement.anchor_payout_instruction() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_payout_execution() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.overdue_instructions(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.overdue_instructions(timestamptz) TO app_rw, app_ro;

CREATE TRIGGER payout_instruction_anchor BEFORE INSERT ON settlement.payout_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_payout_instruction();
CREATE TRIGGER payout_execution_anchor BEFORE INSERT ON settlement.payout_execution
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_payout_execution();
CREATE TRIGGER payout_instruction_no_update_delete BEFORE UPDATE OR DELETE ON settlement.payout_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_instruction_no_truncate BEFORE TRUNCATE ON settlement.payout_instruction
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_execution_no_update_delete BEFORE UPDATE OR DELETE ON settlement.payout_execution
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER payout_execution_no_truncate BEFORE TRUNCATE ON settlement.payout_execution
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();

ALTER TABLE settlement.payout_instruction ENABLE ALWAYS TRIGGER payout_instruction_anchor;
ALTER TABLE settlement.payout_instruction ENABLE ALWAYS TRIGGER payout_instruction_no_update_delete;
ALTER TABLE settlement.payout_instruction ENABLE ALWAYS TRIGGER payout_instruction_no_truncate;
ALTER TABLE settlement.payout_execution ENABLE ALWAYS TRIGGER payout_execution_anchor;
ALTER TABLE settlement.payout_execution ENABLE ALWAYS TRIGGER payout_execution_no_update_delete;
ALTER TABLE settlement.payout_execution ENABLE ALWAYS TRIGGER payout_execution_no_truncate;

GRANT SELECT, INSERT ON settlement.payout_instruction, settlement.payout_execution TO app_rw;
GRANT SELECT ON settlement.payout_instruction, settlement.payout_execution TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON settlement.payout_instruction, settlement.payout_execution FROM app_rw, app_ro;

COMMIT;
