-- Migration 0043 — pièces des bénéficiaires et règlement au bénéficiaire
-- (F-PLN-002, F-PLN-003, D48). Dépend de 0011/0013 (agreements, catalog),
-- 0038 (identifiant comptable), 0040 (schéma settlement) ; 0044 pour
-- la transition PAID_TO_BENEFICIARY.
--
-- Pièce exigée selon la catégorie du bénéficiaire : bailleur ou agence → bail
-- (LEASE) ; vendeur de terrain → titre foncier (LAND_TITLE) ; école, vendeur de
-- matériaux → aucune. Le client de l'accord dépose la pièce (seule son
-- empreinte SHA-256 est conservée ici). La conformité l'examine en
-- maker-checker : une personne propose, une AUTRE confirme (I-7).
-- Règlement : demandé par le client sur un accord C FUNDED ; dans la même
-- transaction, écriture BENEFICIARY_PAYMENT débit 2100 du client / crédit 2200
-- du bénéficiaire (cible), règlement, et FUNDED → PAID_TO_BENEFICIARY.

BEGIN;

CREATE TABLE settlement.beneficiary_document (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL REFERENCES agreements.agreement (id),
  kind text NOT NULL CHECK (kind IN ('LEASE', 'LAND_TITLE')),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  CONSTRAINT beneficiary_document_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE INDEX beneficiary_document_agreement_idx ON settlement.beneficiary_document (agreement_id);

CREATE TABLE settlement.document_review (
  document_id uuid PRIMARY KEY REFERENCES settlement.beneficiary_document (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  prepared_by text NOT NULL CHECK (length(prepared_by) BETWEEN 1 AND 200 AND prepared_by !~ '[[:space:]]'),
  prepared_at timestamptz NOT NULL,
  CONSTRAINT document_review_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);

CREATE TABLE settlement.document_review_approval (
  document_id uuid PRIMARY KEY REFERENCES settlement.document_review (document_id),
  approved_by text NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 200 AND approved_by !~ '[[:space:]]'),
  approved_at timestamptz NOT NULL
);

CREATE TABLE settlement.beneficiary_payment (
  agreement_id uuid PRIMARY KEY REFERENCES agreements.agreement (id),
  beneficiary_id text NOT NULL,
  requested_by uuid NOT NULL,
  entry_id uuid NOT NULL UNIQUE REFERENCES ledger.journal_entry (id),
  paid_at timestamptz NOT NULL
);

-- Pièce exigée pour la catégorie du bénéficiaire de l'accord (NULL : aucune).
CREATE FUNCTION settlement.required_document_kind(p_agreement uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE s.beneficiary_kind
           WHEN 'LANDLORD' THEN 'LEASE'
           WHEN 'AGENCY' THEN 'LEASE'
           WHEN 'LAND_SELLER' THEN 'LAND_TITLE'
           ELSE NULL
         END
  FROM agreements.agreement a
  JOIN catalog.partner_state s ON s.partner_id = a.beneficiary_id
  WHERE a.id = p_agreement
$$;

-- F-PLN-002 : une pièce du type exigé, proposée APPROVED et confirmée par une autre personne.
CREATE FUNCTION settlement.has_validated_document(p_agreement uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM settlement.beneficiary_document d
    JOIN settlement.document_review r ON r.document_id = d.id AND r.decision = 'APPROVED'
    JOIN settlement.document_review_approval x ON x.document_id = d.id
    WHERE d.agreement_id = p_agreement
      AND d.kind = settlement.required_document_kind(p_agreement)
  )
$$;

CREATE FUNCTION settlement.anchor_beneficiary_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  agreement_customer uuid;
BEGIN
  SELECT model, customer_id INTO agreement_model, agreement_customer
  FROM agreements.agreement WHERE id = NEW.agreement_id;
  IF agreement_model IS DISTINCT FROM 'PLANNED_EXPENSE'
     OR agreement_customer IS DISTINCT FROM NEW.submitted_by THEN
    RAISE EXCEPTION 'SETTLEMENT_INVALID_REQUEST: pièce déposée hors de l’objectif C du client';
  END IF;
  IF settlement.required_document_kind(NEW.agreement_id) IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'SETTLEMENT_INVALID_REQUEST: pièce % non exigée pour ce bénéficiaire', NEW.kind;
  END IF;
  NEW.submitted_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_document_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_document_review_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preparer text;
BEGIN
  SELECT prepared_by INTO preparer FROM settlement.document_review WHERE document_id = NEW.document_id;
  IF preparer = NEW.approved_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: la confirmation exige une autre personne que la proposition';
  END IF;
  NEW.approved_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_beneficiary_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  agreement_status text;
  agreement_customer uuid;
  agreement_beneficiary text;
  agreement_target bigint;
  beneficiary_owner uuid;
  entry_type text;
  entry_agreement text;
  line_count integer;
  client_debit bigint;
  beneficiary_credit bigint;
BEGIN
  SELECT a.model, s.status, a.customer_id, a.beneficiary_id, a.target_xaf
    INTO agreement_model, agreement_status, agreement_customer, agreement_beneficiary, agreement_target
  FROM agreements.agreement a JOIN agreements.agreement_state s ON s.id = a.id
  WHERE a.id = NEW.agreement_id;
  IF agreement_model IS DISTINCT FROM 'PLANNED_EXPENSE' OR agreement_status IS DISTINCT FROM 'FUNDED' THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FUNDED: accord à l’état %', agreement_status;
  END IF;
  IF agreement_customer IS DISTINCT FROM NEW.requested_by
     OR agreement_beneficiary IS DISTINCT FROM NEW.beneficiary_id THEN
    RAISE EXCEPTION 'SETTLEMENT_INVALID_REQUEST: client ou bénéficiaire différent de l’accord';
  END IF;
  IF settlement.required_document_kind(NEW.agreement_id) IS NOT NULL
     AND NOT settlement.has_validated_document(NEW.agreement_id) THEN
    RAISE EXCEPTION 'SETTLEMENT_DOCUMENT_REQUIRED: pièce du bénéficiaire non validée par la conformité';
  END IF;
  SELECT owner_id INTO beneficiary_owner
  FROM catalog.partner_ledger_identity WHERE partner_id = NEW.beneficiary_id;
  SELECT e.operation_type, e.business_refs ->> 'agreement_id' INTO entry_type, entry_agreement
  FROM ledger.journal_entry e WHERE e.id = NEW.entry_id;
  SELECT count(*),
         COALESCE(sum(p.amount_xaf) FILTER (
           WHERE p.direction = 'D' AND acc.code = '2100' AND acc.owner_type = 'CLIENT'
             AND acc.owner_id = agreement_customer), 0),
         COALESCE(sum(p.amount_xaf) FILTER (
           WHERE p.direction = 'C' AND acc.code = '2200' AND acc.owner_type = 'PARTNER'
             AND acc.owner_id = beneficiary_owner), 0)
    INTO line_count, client_debit, beneficiary_credit
  FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
  WHERE p.entry_id = NEW.entry_id;
  IF entry_type IS DISTINCT FROM 'BENEFICIARY_PAYMENT'
     OR entry_agreement IS DISTINCT FROM NEW.agreement_id::text
     OR beneficiary_owner IS NULL
     OR line_count <> 2
     OR client_debit <> agreement_target
     OR beneficiary_credit <> agreement_target THEN
    RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: écriture de règlement au bénéficiaire non conforme';
  END IF;
  NEW.paid_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Pas de règlement sans état : à la validation, l'accord est passé PAID_TO_BENEFICIARY.
CREATE FUNCTION settlement.assert_beneficiary_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_from text;
  last_to text;
BEGIN
  SELECT e.from_status, e.to_status INTO last_from, last_to
  FROM agreements.status_event e
  WHERE e.agreement_id = NEW.agreement_id AND e.kind = 'TRANSITION'
  ORDER BY e.seq DESC LIMIT 1;
  IF last_from IS DISTINCT FROM 'FUNDED' OR last_to IS DISTINCT FROM 'PAID_TO_BENEFICIARY' THEN
    RAISE EXCEPTION 'SETTLEMENT_INCOMPLETE: l’accord n’est pas passé à PAID_TO_BENEFICIARY';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION settlement.required_document_kind(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.has_validated_document(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_document_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_document_review_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_beneficiary_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.assert_beneficiary_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.required_document_kind(uuid) TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION settlement.has_validated_document(uuid) TO app_rw, app_ro;

CREATE TRIGGER beneficiary_document_anchor BEFORE INSERT ON settlement.beneficiary_document
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_document();
CREATE TRIGGER document_review_anchor BEFORE INSERT ON settlement.document_review
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_document_review();
CREATE TRIGGER document_review_approval_anchor BEFORE INSERT ON settlement.document_review_approval
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_document_review_approval();
CREATE TRIGGER beneficiary_payment_anchor BEFORE INSERT ON settlement.beneficiary_payment
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_beneficiary_payment();
CREATE CONSTRAINT TRIGGER beneficiary_payment_transition AFTER INSERT ON settlement.beneficiary_payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION settlement.assert_beneficiary_transition();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['beneficiary_document', 'document_review', 'document_review_approval', 'beneficiary_payment'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON settlement.%I FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON settlement.%I FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('GRANT SELECT, INSERT ON settlement.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON settlement.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON settlement.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;

ALTER TABLE settlement.beneficiary_document ENABLE ALWAYS TRIGGER beneficiary_document_anchor;
ALTER TABLE settlement.document_review ENABLE ALWAYS TRIGGER document_review_anchor;
ALTER TABLE settlement.document_review_approval ENABLE ALWAYS TRIGGER document_review_approval_anchor;
ALTER TABLE settlement.beneficiary_payment ENABLE ALWAYS TRIGGER beneficiary_payment_anchor;
ALTER TABLE settlement.beneficiary_payment ENABLE ALWAYS TRIGGER beneficiary_payment_transition;

COMMIT;
