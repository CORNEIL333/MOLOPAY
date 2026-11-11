-- Migration 0048 — trop-perçu et nouvelle tentative de remboursement
-- (F-PAY, D39, D49, D51). Dépend de 0045 et 0046.
--
-- D39 laisse possible un trop-perçu : deux tentatives concurrentes, chacune
-- inférieure au reste dû, peuvent toutes deux être confirmées. Le surplus
-- (versements confirmés − cible − déjà remboursé) est restitué au client par
-- le même circuit que D49, avec la nature SURPLUS, sur un objectif dont la
-- cible est atteinte (FUNDED, HANDED_OVER, PAID_TO_BENEFICIARY) ; l'objectif
-- ne change pas d'état.
-- Un remboursement refusé par l'approbateur ou par l'établissement peut être
-- préparé de nouveau : un seul remboursement EN COURS par objectif (au lieu
-- d'un seul à vie). Le montant déduit toujours ce qui a déjà été remboursé
-- (écritures REFUND_SENT de l'objectif) : aucun double remboursement.

BEGIN;

ALTER TABLE settlement.refund
  ADD COLUMN kind text NOT NULL DEFAULT 'CANCELLATION' CHECK (kind IN ('CANCELLATION', 'SURPLUS'));
ALTER TABLE settlement.refund ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE settlement.refund DROP CONSTRAINT refund_agreement_id_key;
CREATE INDEX refund_agreement_idx ON settlement.refund (agreement_id);

-- Montant déjà rendu au client pour cet objectif (débits 2100 des REFUND_SENT).
CREATE FUNCTION settlement.refunded_xaf(p_agreement uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(p.amount_xaf), 0)::bigint
  FROM ledger.journal_entry e
  JOIN ledger.posting p ON p.entry_id = e.id AND p.direction = 'D'
  JOIN ledger.account acc ON acc.id = p.account_id AND acc.code = '2100' AND acc.owner_type = 'CLIENT'
  JOIN agreements.agreement a ON a.id = p_agreement AND acc.owner_id = a.customer_id
  WHERE e.operation_type = 'REFUND_SENT'
    AND e.business_refs ->> 'agreement_id' = p_agreement::text
$$;

CREATE OR REPLACE FUNCTION settlement.anchor_refund() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_status text;
  agreement_customer uuid;
  agreement_target bigint;
  confirmed bigint;
BEGIN
  -- Sérialise les préparations d'un même objectif (deux préparations
  -- concurrentes ne voient pas l'une l'autre sans ce verrou).
  PERFORM pg_advisory_xact_lock(hashtextextended('settlement.refund:' || NEW.agreement_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM settlement.refund r
    WHERE r.agreement_id = NEW.agreement_id
      AND NOT EXISTS (SELECT 1 FROM settlement.refund_decision d WHERE d.refund_id = r.id AND d.decision = 'REJECTED')
      AND NOT EXISTS (SELECT 1 FROM settlement.refund_execution x WHERE x.refund_id = r.id)
  ) THEN
    RAISE EXCEPTION 'REFUND_ALREADY_PREPARED: un remboursement est déjà en cours pour cet objectif';
  END IF;
  SELECT s.status, a.customer_id, a.target_xaf INTO agreement_status, agreement_customer, agreement_target
  FROM agreements.agreement a JOIN agreements.agreement_state s ON s.id = a.id
  WHERE a.id = NEW.agreement_id;
  confirmed := agreements.confirmed_funds_xaf(NEW.agreement_id);
  IF NEW.kind = 'CANCELLATION' THEN
    IF agreement_status IS NULL OR agreement_status NOT IN ('CANCELLED_BY_CUSTOMER', 'FROZEN', 'DISPUTED') THEN
      RAISE EXCEPTION 'REFUND_NOT_ALLOWED: objectif à l’état %', agreement_status;
    END IF;
    NEW.amount_xaf := confirmed - settlement.refunded_xaf(NEW.agreement_id);
  ELSE
    IF agreement_status IS NULL OR agreement_status NOT IN ('FUNDED', 'HANDED_OVER', 'PAID_TO_BENEFICIARY') THEN
      RAISE EXCEPTION 'REFUND_NOT_ALLOWED: trop-perçu restituable seulement cible atteinte (état %)', agreement_status;
    END IF;
    NEW.amount_xaf := confirmed - agreement_target - settlement.refunded_xaf(NEW.agreement_id);
  END IF;
  NEW.customer_id := agreement_customer;
  IF NEW.amount_xaf <= 0 THEN
    RAISE EXCEPTION 'REFUND_NOT_ALLOWED: aucun montant à rembourser';
  END IF;
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Pas de remboursement d'annulation exécuté sans état REFUNDED ; le
-- trop-perçu ne change pas l'état de l'objectif.
CREATE OR REPLACE FUNCTION settlement.assert_refund_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.outcome = 'EXECUTED'
     AND (SELECT r.kind FROM settlement.refund r WHERE r.id = NEW.refund_id) = 'CANCELLATION'
     AND (
       SELECT e.to_status FROM agreements.status_event e
       JOIN settlement.refund r ON r.agreement_id = e.agreement_id
       WHERE r.id = NEW.refund_id AND e.kind = 'TRANSITION'
       ORDER BY e.seq DESC LIMIT 1
     ) IS DISTINCT FROM 'REFUNDED' THEN
    RAISE EXCEPTION 'REFUND_INCOMPLETE: l’objectif n’est pas passé à REFUNDED';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION settlement.refunded_xaf(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.refunded_xaf(uuid) TO app_rw, app_ro;

COMMIT;
