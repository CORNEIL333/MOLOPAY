-- Migration 0045 — remboursements au client (F-PLN-004, F-SAV-005, F-SET-003/004,
-- CDC_05 § 5.4, D49). Dépend de 0029 (confirmed_funds_xaf) et 0040 (settlement).
--
-- Préparation : objectif annulé, gelé ou en litige ; montant calculé par la base
-- = tous les versements confirmés (barème 100 % sans frais, D27).
-- Décision : par une autre personne (I-7). Instruction : document canonique
-- signé Ed25519 par la plateforme. Exécution : rapportée par l'établissement,
-- enregistrée par une autre personne que l'émetteur ; EXECUTED passe, dans la
-- même transaction, l'écriture REFUND_SENT débit 2100 du client / crédit 1100
-- et la transition vers REFUNDED (0046) ; REJECTED n'écrit rien.

BEGIN;

CREATE TABLE settlement.refund (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL UNIQUE REFERENCES agreements.agreement (id),
  customer_id uuid NOT NULL,
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  prepared_by text NOT NULL CHECK (length(prepared_by) BETWEEN 1 AND 200 AND prepared_by !~ '[[:space:]]'),
  prepared_at timestamptz NOT NULL,
  CONSTRAINT refund_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE TABLE settlement.refund_decision (
  refund_id uuid PRIMARY KEY REFERENCES settlement.refund (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  decided_at timestamptz NOT NULL,
  CONSTRAINT refund_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);

CREATE TABLE settlement.refund_instruction (
  refund_id uuid PRIMARY KEY REFERENCES settlement.refund (id),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  document_hash bytea NOT NULL CHECK (octet_length(document_hash) = 32),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 100 AND key_id !~ '[[:space:]]'),
  instructed_by text NOT NULL CHECK (length(instructed_by) BETWEEN 1 AND 200 AND instructed_by !~ '[[:space:]]'),
  instructed_at timestamptz NOT NULL
);

CREATE TABLE settlement.refund_execution (
  refund_id uuid PRIMARY KEY REFERENCES settlement.refund_instruction (refund_id),
  outcome text NOT NULL CHECK (outcome IN ('EXECUTED', 'REJECTED')),
  bank_reference text NOT NULL CHECK (bank_reference ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  entry_id uuid NULL UNIQUE REFERENCES ledger.journal_entry (id),
  recorded_by text NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 200 AND recorded_by !~ '[[:space:]]'),
  recorded_at timestamptz NOT NULL,
  CONSTRAINT refund_execution_rejected_no_entry CHECK (outcome <> 'REJECTED' OR entry_id IS NULL)
);

CREATE FUNCTION settlement.anchor_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_status text;
  agreement_customer uuid;
BEGIN
  SELECT s.status, a.customer_id INTO agreement_status, agreement_customer
  FROM agreements.agreement a JOIN agreements.agreement_state s ON s.id = a.id
  WHERE a.id = NEW.agreement_id;
  IF agreement_status IS NULL OR agreement_status NOT IN ('CANCELLED_BY_CUSTOMER', 'FROZEN', 'DISPUTED') THEN
    RAISE EXCEPTION 'REFUND_NOT_ALLOWED: objectif à l’état %', agreement_status;
  END IF;
  NEW.customer_id := agreement_customer;
  NEW.amount_xaf := agreements.confirmed_funds_xaf(NEW.agreement_id);
  IF NEW.amount_xaf <= 0 THEN
    RAISE EXCEPTION 'REFUND_NOT_ALLOWED: aucun versement à rembourser';
  END IF;
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_refund_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT prepared_by FROM settlement.refund WHERE id = NEW.refund_id) = NEW.decided_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas décider';
  END IF;
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_refund_instruction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  refund_decision text;
  refund_customer uuid;
  refund_amount bigint;
  doc_keys text[];
BEGIN
  SELECT d.decision, r.customer_id, r.amount_xaf INTO refund_decision, refund_customer, refund_amount
  FROM settlement.refund r LEFT JOIN settlement.refund_decision d ON d.refund_id = r.id
  WHERE r.id = NEW.refund_id;
  IF refund_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'REFUND_NOT_APPROVED: remboursement non approuvé';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO doc_keys FROM jsonb_object_keys(NEW.document) AS k;
  IF doc_keys IS DISTINCT FROM ARRAY['amount_xaf', 'customer_id', 'domain', 'refund_id']::text[]
     OR NEW.document->>'domain' IS DISTINCT FROM 'refund-instruction-v1'
     OR NEW.document->>'refund_id' IS DISTINCT FROM NEW.refund_id::text
     OR NEW.document->>'customer_id' IS DISTINCT FROM refund_customer::text
     OR NEW.document->>'amount_xaf' IS DISTINCT FROM refund_amount::text THEN
    RAISE EXCEPTION 'REFUND_INSTRUCTION_MISMATCH: instruction différente du remboursement approuvé';
  END IF;
  NEW.instructed_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_refund_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  instructor text;
  refund_customer uuid;
  refund_amount bigint;
  refund_agreement uuid;
  entry_type text;
  entry_refund text;
  entry_agreement text;
  line_count integer;
  client_debit bigint;
  treasury_credit bigint;
BEGIN
  SELECT i.instructed_by, r.customer_id, r.amount_xaf, r.agreement_id
    INTO instructor, refund_customer, refund_amount, refund_agreement
  FROM settlement.refund_instruction i JOIN settlement.refund r ON r.id = i.refund_id
  WHERE i.refund_id = NEW.refund_id;
  IF instructor = NEW.recorded_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''émetteur ne confirme pas son instruction';
  END IF;
  IF NEW.outcome = 'EXECUTED' THEN
    SELECT e.operation_type, e.business_refs ->> 'refund_id', e.business_refs ->> 'agreement_id'
      INTO entry_type, entry_refund, entry_agreement
    FROM ledger.journal_entry e WHERE e.id = NEW.entry_id;
    SELECT count(*),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'D' AND acc.code = '2100' AND acc.owner_type = 'CLIENT'
               AND acc.owner_id = refund_customer), 0),
           COALESCE(sum(p.amount_xaf) FILTER (
             WHERE p.direction = 'C' AND acc.code = '1100' AND acc.owner_type IS NULL), 0)
      INTO line_count, client_debit, treasury_credit
    FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
    WHERE p.entry_id = NEW.entry_id;
    IF entry_type IS DISTINCT FROM 'REFUND_SENT'
       OR entry_refund IS DISTINCT FROM NEW.refund_id::text
       OR entry_agreement IS DISTINCT FROM refund_agreement::text
       OR line_count <> 2
       OR client_debit <> refund_amount
       OR treasury_credit <> refund_amount THEN
      RAISE EXCEPTION 'REFUND_INCOMPLETE: écriture de remboursement absente ou non conforme';
    END IF;
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Pas de remboursement exécuté sans état : à la validation, l'objectif est REFUNDED.
CREATE FUNCTION settlement.assert_refund_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome = 'EXECUTED' AND (
    SELECT e.to_status FROM agreements.status_event e
    JOIN settlement.refund r ON r.agreement_id = e.agreement_id
    WHERE r.id = NEW.refund_id AND e.kind = 'TRANSITION'
    ORDER BY e.seq DESC LIMIT 1
  ) IS DISTINCT FROM 'REFUNDED' THEN
    RAISE EXCEPTION 'REFUND_INCOMPLETE: l’objectif n’est pas passé à REFUNDED';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION settlement.anchor_refund() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_refund_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_refund_instruction() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_refund_execution() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.assert_refund_transition() FROM PUBLIC;

CREATE TRIGGER refund_anchor BEFORE INSERT ON settlement.refund
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_refund();
CREATE TRIGGER refund_decision_anchor BEFORE INSERT ON settlement.refund_decision
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_refund_decision();
CREATE TRIGGER refund_instruction_anchor BEFORE INSERT ON settlement.refund_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_refund_instruction();
CREATE TRIGGER refund_execution_anchor BEFORE INSERT ON settlement.refund_execution
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_refund_execution();
CREATE CONSTRAINT TRIGGER refund_execution_transition AFTER INSERT ON settlement.refund_execution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION settlement.assert_refund_transition();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['refund', 'refund_decision', 'refund_instruction', 'refund_execution'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON settlement.%I FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON settlement.%I FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('GRANT SELECT, INSERT ON settlement.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON settlement.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON settlement.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;

ALTER TABLE settlement.refund ENABLE ALWAYS TRIGGER refund_anchor;
ALTER TABLE settlement.refund_decision ENABLE ALWAYS TRIGGER refund_decision_anchor;
ALTER TABLE settlement.refund_instruction ENABLE ALWAYS TRIGGER refund_instruction_anchor;
ALTER TABLE settlement.refund_execution ENABLE ALWAYS TRIGGER refund_execution_anchor;
ALTER TABLE settlement.refund_execution ENABLE ALWAYS TRIGGER refund_execution_transition;

COMMIT;
