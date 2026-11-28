-- Migration 0047 — sortie des fonds vers le bénéficiaire du modèle C
-- (F-PLN-003, F-SET-003/004, CDC_05 § 5.4, D50). Dépend de 0042, 0043, 0045.
--
-- Après le règlement au bénéficiaire (0043 : 2100 du client → 2200 du
-- bénéficiaire), les fonds restent au compte cantonné jusqu'à leur virement.
-- Préparation : un virement par règlement ; bénéficiaire et montant (cible
-- de l'objectif, sans commission) calculés par la base. Décision par une
-- autre personne (I-7). Instruction canonique signée Ed25519 par la
-- plateforme. Exécution rapportée par l'établissement, enregistrée par une
-- autre personne que l'émetteur ; EXECUTED passe dans la même transaction
-- l'écriture SETTLEMENT_SENT débit 2200 du bénéficiaire / crédit 1100 ;
-- REJECTED n'écrit rien (le montant reste dû au bénéficiaire).
-- Alerte à 24 h commune aux règlements, remboursements et virements.

BEGIN;

CREATE TABLE settlement.beneficiary_payout (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL UNIQUE REFERENCES settlement.beneficiary_payment (agreement_id),
  beneficiary_id text NOT NULL,
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  prepared_by text NOT NULL CHECK (length(prepared_by) BETWEEN 1 AND 200 AND prepared_by !~ '[[:space:]]'),
  prepared_at timestamptz NOT NULL,
  CONSTRAINT beneficiary_payout_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE TABLE settlement.beneficiary_payout_decision (
  payout_id uuid PRIMARY KEY REFERENCES settlement.beneficiary_payout (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  decided_at timestamptz NOT NULL,
  CONSTRAINT beneficiary_payout_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);

CREATE TABLE settlement.beneficiary_payout_instruction (
  payout_id uuid PRIMARY KEY REFERENCES settlement.beneficiary_payout (id),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  document_hash bytea NOT NULL CHECK (octet_length(document_hash) = 32),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 100 AND key_id !~ '[[:space:]]'),
  instructed_by text NOT NULL CHECK (length(instructed_by) BETWEEN 1 AND 200 AND instructed_by !~ '[[:space:]]'),
  instructed_at timestamptz NOT NULL
);

CREATE TABLE settlement.beneficiary_payout_execution (
  payout_id uuid PRIMARY KEY REFERENCES settlement.beneficiary_payout_instruction (payout_id),
  outcome text NOT NULL CHECK (outcome IN ('EXECUTED', 'REJECTED')),
  bank_reference text NOT NULL CHECK (bank_reference ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  entry_id uuid NULL UNIQUE REFERENCES ledger.journal_entry (id),
  recorded_by text NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 200 AND recorded_by !~ '[[:space:]]'),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT beneficiary_payout_execution_rejected_no_entry CHECK (outcome <> 'REJECTED' OR entry_id IS NULL)
);

CREATE FUNCTION settlement.anchor_beneficiary_payout() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid_beneficiary text;
  agreement_target bigint;
BEGIN
  SELECT b.beneficiary_id, a.target_xaf INTO paid_beneficiary, agreement_target
  FROM settlement.beneficiary_payment b JOIN agreements.agreement a ON a.id = b.agreement_id
  WHERE b.agreement_id = NEW.agreement_id;
  IF paid_beneficiary IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FUNDED: aucun règlement au bénéficiaire pour cet objectif';
  END IF;
  NEW.beneficiary_id := paid_beneficiary;
  NEW.amount_xaf := agreement_target;
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_beneficiary_payout_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT prepared_by FROM settlement.beneficiary_payout WHERE id = NEW.payout_id) = NEW.decided_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas décider';
  END IF;
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_beneficiary_payout_instruction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payout_decision text;
  payout_beneficiary text;
  payout_amount bigint;
  doc_keys text[];
BEGIN
  SELECT d.decision, p.beneficiary_id, p.amount_xaf INTO payout_decision, payout_beneficiary, payout_amount
  FROM settlement.beneficiary_payout p
  LEFT JOIN settlement.beneficiary_payout_decision d ON d.payout_id = p.id
  WHERE p.id = NEW.payout_id;
  IF payout_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_APPROVED: virement non approuvé';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO doc_keys FROM jsonb_object_keys(NEW.document) AS k;
  IF doc_keys IS DISTINCT FROM ARRAY['amount_xaf', 'beneficiary_id', 'domain', 'payout_id']::text[]
     OR NEW.document->>'domain' IS DISTINCT FROM 'beneficiary-payout-instruction-v1'
     OR NEW.document->>'payout_id' IS DISTINCT FROM NEW.payout_id::text
     OR NEW.document->>'beneficiary_id' IS DISTINCT FROM payout_beneficiary
     OR NEW.document->>'amount_xaf' IS DISTINCT FROM payout_amount::text THEN
    RAISE EXCEPTION 'SETTLEMENT_INSTRUCTION_MISMATCH: instruction différente du virement approuvé';
  END IF;
  NEW.instructed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_beneficiary_payout_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  instructor text;
  payout_beneficiary text;
  payout_amount bigint;
  beneficiary_owner uuid;
  entry_type text;
  entry_payout text;
  line_count integer;
  beneficiary_debit bigint;
  treasury_credit bigint;
BEGIN
  SELECT i.instructed_by, p.beneficiary_id, p.amount_xaf INTO instructor, payout_beneficiary, payout_amount
  FROM settlement.beneficiary_payout_instruction i
  JOIN settlement.beneficiary_payout p ON p.id = i.payout_id
  WHERE i.payout_id = NEW.payout_id;
  IF instructor = NEW.recorded_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''émetteur ne confirme pas son instruction';
  END IF;
  IF NEW.outcome = 'EXECUTED' THEN
    SELECT owner_id INTO beneficiary_owner
    FROM catalog.partner_ledger_identity WHERE partner_id = payout_beneficiary;
    SELECT e.operation_type, e.business_refs ->> 'beneficiary_payout_id' INTO entry_type, entry_payout
    FROM ledger.journal_entry e WHERE e.id = NEW.entry_id;
    SELECT count(*),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'D' AND acc.code = '2200' AND acc.owner_type = 'PARTNER'
               AND acc.owner_id = beneficiary_owner), 0),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'C' AND acc.code = '1100' AND acc.owner_type IS NULL), 0)
      INTO line_count, beneficiary_debit, treasury_credit
    FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
    WHERE p.entry_id = NEW.entry_id;
    IF entry_type IS DISTINCT FROM 'SETTLEMENT_SENT'
       OR entry_payout IS DISTINCT FROM NEW.payout_id::text
       OR line_count <> 2
       OR beneficiary_debit <> payout_amount
       OR treasury_credit <> payout_amount THEN
      RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: écriture de virement absente ou non conforme';
    END IF;
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;

-- F-SET-004 : toute instruction sortante (règlement, remboursement, virement)
-- sans exécution enregistrée depuis plus de 24 h à `p_at`.
CREATE FUNCTION settlement.overdue_outgoing_instructions(p_at timestamptz)
RETURNS TABLE (kind text, instruction_id uuid, instructed_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT 'PAYOUT'::text, i.payout_id, i.instructed_at
    FROM settlement.payout_instruction i
    WHERE NOT EXISTS (SELECT 1 FROM settlement.payout_execution x WHERE x.payout_id = i.payout_id)
    UNION ALL
    SELECT 'REFUND'::text, i.refund_id, i.instructed_at
    FROM settlement.refund_instruction i
    WHERE NOT EXISTS (SELECT 1 FROM settlement.refund_execution x WHERE x.refund_id = i.refund_id)
    UNION ALL
    SELECT 'BENEFICIARY_PAYOUT'::text, i.payout_id, i.instructed_at
    FROM settlement.beneficiary_payout_instruction i
    WHERE NOT EXISTS (SELECT 1 FROM settlement.beneficiary_payout_execution x WHERE x.payout_id = i.payout_id)
  ) AS pending (kind, instruction_id, instructed_at)
  WHERE p_at - pending.instructed_at > interval '24 hours'
  ORDER BY pending.instructed_at
$$;

REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_payout() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_payout_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_payout_instruction() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_payout_execution() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.overdue_outgoing_instructions(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.overdue_outgoing_instructions(timestamptz) TO app_rw, app_ro;

CREATE TRIGGER beneficiary_payout_anchor BEFORE INSERT ON settlement.beneficiary_payout
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_payout();
CREATE TRIGGER beneficiary_payout_decision_anchor BEFORE INSERT ON settlement.beneficiary_payout_decision
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_payout_decision();
CREATE TRIGGER beneficiary_payout_instruction_anchor BEFORE INSERT ON settlement.beneficiary_payout_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_payout_instruction();
CREATE TRIGGER beneficiary_payout_execution_anchor BEFORE INSERT ON settlement.beneficiary_payout_execution
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_payout_execution();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['beneficiary_payout', 'beneficiary_payout_decision', 'beneficiary_payout_instruction', 'beneficiary_payout_execution'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON settlement.%I FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON settlement.%I FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('GRANT SELECT, INSERT ON settlement.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON settlement.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON settlement.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;

COMMIT;
