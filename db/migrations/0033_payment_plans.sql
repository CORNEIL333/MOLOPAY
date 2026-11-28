-- Migration 0033 — plans de paiement approuvés (D26, F-CAT-002, I-7).
-- Dépend de 0003 (admin) et 0008 (catalog).
--
-- Un plan est défini par la plateforme : modèle (A ou C ; B fermé jusqu'au
-- lot 13), rythme, montant minimal par versement, durée maximale en mois
-- (1 à 36, D27). Aucun frais ni taux. Il n'entre au registre qu'adossé à une
-- demande maker-checker PAYMENT_PLAN approuvée par une autre personne, dont
-- la charge porte exactement ces conditions et rien d'autre.
-- Un plan est immuable : changer une condition = nouveau plan.

BEGIN;

-- Nouveau type de demande (extension de la liste blanche de 0003).
ALTER TABLE admin.approval_request DROP CONSTRAINT approval_request_kind_check;
ALTER TABLE admin.approval_request ADD CONSTRAINT approval_request_kind_check CHECK (kind IN (
  'SETTLEMENT',
  'REFUND',
  'LEDGER_REVERSAL',
  'FINANCIAL_SETTING',
  'PARTNER_APPROVAL',
  'PAYMENT_PLAN',
  'ROLE_GRANT',
  'BREAK_GLASS'
));

CREATE TABLE catalog.payment_plan (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  model text NOT NULL CHECK (model IN ('SAVE_THEN_BUY', 'PLANNED_EXPENSE')),
  rhythm text NOT NULL CHECK (rhythm IN ('DAILY', 'WEEKLY', 'MONTHLY', 'FREE')),
  min_amount_xaf bigint NOT NULL CHECK (min_amount_xaf > 0),
  max_duration_months integer NOT NULL CHECK (max_duration_months BETWEEN 1 AND 36),
  approval_request_id uuid NOT NULL UNIQUE REFERENCES admin.approval_request (id),
  approved_at timestamptz NOT NULL
);

CREATE FUNCTION catalog.assert_payment_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_kind text;
  request_payload jsonb;
  request_maker text;
  request_decision text;
  request_checker text;
  payload_keys text[];
BEGIN
  SELECT r.kind, r.payload, r.maker_id, d.decision, d.decided_by
    INTO request_kind, request_payload, request_maker, request_decision, request_checker
  FROM admin.approval_request r
  LEFT JOIN admin.approval_decision d ON d.request_id = r.id
  WHERE r.id = NEW.approval_request_id;
  IF NOT FOUND OR request_kind <> 'PAYMENT_PLAN'
     OR request_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'CATALOG_PLAN_NOT_APPROVED: demande % non approuvée', NEW.approval_request_id;
  END IF;
  IF request_checker = request_maker THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas approuver';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO payload_keys
  FROM jsonb_object_keys(request_payload) AS k;
  IF payload_keys IS DISTINCT FROM
     ARRAY['max_duration_months', 'min_amount_xaf', 'model', 'plan_id', 'rhythm']::text[] THEN
    RAISE EXCEPTION 'CATALOG_FIELD_FORBIDDEN: charge approuvée hors liste blanche';
  END IF;
  IF request_payload->>'plan_id' IS DISTINCT FROM NEW.id
     OR request_payload->>'model' IS DISTINCT FROM NEW.model
     OR request_payload->>'rhythm' IS DISTINCT FROM NEW.rhythm
     OR request_payload->>'min_amount_xaf' IS DISTINCT FROM NEW.min_amount_xaf::text
     OR request_payload->>'max_duration_months' IS DISTINCT FROM NEW.max_duration_months::text THEN
    RAISE EXCEPTION 'CATALOG_PLAN_NOT_APPROVED: l''approbation ne porte pas sur ce plan';
  END IF;
  NEW.approved_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.assert_payment_plan() FROM PUBLIC;

CREATE TRIGGER payment_plan_verify
  BEFORE INSERT ON catalog.payment_plan
  FOR EACH ROW EXECUTE FUNCTION catalog.assert_payment_plan();
CREATE TRIGGER payment_plan_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.payment_plan
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER payment_plan_no_truncate
  BEFORE TRUNCATE ON catalog.payment_plan
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();

ALTER TABLE catalog.payment_plan ENABLE ALWAYS TRIGGER payment_plan_verify;
ALTER TABLE catalog.payment_plan ENABLE ALWAYS TRIGGER payment_plan_no_update_delete;
ALTER TABLE catalog.payment_plan ENABLE ALWAYS TRIGGER payment_plan_no_truncate;

GRANT SELECT, INSERT ON catalog.payment_plan TO app_rw;
GRANT SELECT ON catalog.payment_plan TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON catalog.payment_plan FROM app_rw, app_ro;

COMMIT;
