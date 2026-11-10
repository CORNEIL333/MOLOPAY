-- Migration 0029 — passage d'un accord à FUNDED adossé au grand livre
-- (lot 10/11 : F-SAV-002, F-SAV-004 en amont, I-6, I-9).
-- Dépend de 0001 (ledger), 0015 (agreements.assert_status_event) et 0027.
--
-- Les fonds versés sur un accord sont DÉRIVÉS des écritures PAYMENT_CONFIRMED
-- du grand livre (crédits 2100 du client de l'accord, référence agreement_id),
-- jamais affirmés. ACTIVE → FUNDED (et le retour d'un litige vers FUNDED)
-- n'est accepté que si ces fonds atteignent la cible. Les autres états qui
-- supposent un mouvement de fonds restent refusés (lot 12).
-- La fonction ci-dessous reprend 0015 à l'identique, sauf la règle FUNDED.
-- Limite : les remboursements (lot 12) devront être déduits de ce calcul.

BEGIN;

CREATE FUNCTION agreements.confirmed_funds_xaf(p_agreement uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(p.amount_xaf), 0)::bigint
  FROM agreements.agreement ag
  JOIN ledger.journal_entry e
    ON e.operation_type = 'PAYMENT_CONFIRMED'
   AND e.business_refs ->> 'agreement_id' = ag.id::text
  JOIN ledger.posting p ON p.entry_id = e.id AND p.direction = 'C'
  JOIN ledger.account a
    ON a.id = p.account_id AND a.code = '2100'
   AND a.owner_type = 'CLIENT' AND a.owner_id = ag.customer_id
  WHERE ag.id = p_agreement
$$;

REVOKE ALL ON FUNCTION agreements.confirmed_funds_xaf(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agreements.confirmed_funds_xaf(uuid) TO app_rw, app_ro;

CREATE OR REPLACE FUNCTION agreements.assert_status_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  latest_seq integer;
  current_status text;
  is_locked boolean;
  dispute_origin text;
  scope text;
  partner_defaulted boolean;
  target bigint;
BEGIN
  -- Pas de verrou de ligne (app_rw n'a pas UPDATE) : deux ajouts concurrents
  -- calculent la même séquence et la clé primaire n'en accepte qu'un.
  SELECT model INTO agreement_model
  FROM agreements.agreement WHERE id = NEW.agreement_id;
  SELECT max(seq) INTO latest_seq
  FROM agreements.status_event WHERE agreement_id = NEW.agreement_id;
  IF NEW.seq <> COALESCE(latest_seq, 0) + 1 THEN
    RAISE EXCEPTION 'AGREEMENT_INVALID_REQUEST: séquence % attendue, % reçue',
      COALESCE(latest_seq, 0) + 1, NEW.seq;
  END IF;
  SELECT e.to_status INTO current_status
  FROM agreements.status_event e
  WHERE e.agreement_id = NEW.agreement_id AND e.seq = latest_seq;
  current_status := COALESCE(current_status, 'DRAFT');
  IF NEW.from_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: état courant %, reçu %',
      current_status, NEW.from_status;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM agreements.status_event
    WHERE agreement_id = NEW.agreement_id AND kind = 'LOCK'
  ) INTO is_locked;

  IF NEW.kind = 'LOCK' THEN
    IF is_locked THEN
      RAISE EXCEPTION 'AGREEMENT_LOCKED: objectif déjà verrouillé';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;

  scope := CASE NEW.from_status || '>' || NEW.to_status
    WHEN 'DRAFT>ACTIVE' THEN 'ANY'
    WHEN 'ACTIVE>FUNDED' THEN 'ANY'
    WHEN 'FUNDED>HANDED_OVER' THEN 'SAVE_THEN_BUY'
    WHEN 'FUNDED>PAID_TO_BENEFICIARY' THEN 'PLANNED_EXPENSE'
    WHEN 'HANDED_OVER>CLOSED' THEN 'SAVE_THEN_BUY'
    WHEN 'PAID_TO_BENEFICIARY>CLOSED' THEN 'PLANNED_EXPENSE'
    WHEN 'ACTIVE>CANCELLED_BY_CUSTOMER' THEN 'ANY'
    WHEN 'CANCELLED_BY_CUSTOMER>REFUNDED' THEN 'ANY'
    WHEN 'REFUNDED>CLOSED' THEN 'ANY'
    WHEN 'ACTIVE>DISPUTED' THEN 'ANY'
    WHEN 'FUNDED>DISPUTED' THEN 'ANY'
    WHEN 'DISPUTED>ACTIVE' THEN 'ANY'
    WHEN 'DISPUTED>FUNDED' THEN 'ANY'
    WHEN 'DISPUTED>REFUNDED' THEN 'ANY'
    WHEN 'ACTIVE>FROZEN' THEN 'ANY'
    WHEN 'FROZEN>ACTIVE' THEN 'ANY'
    WHEN 'FROZEN>REFUNDED' THEN 'ANY'
    ELSE NULL
  END;
  IF scope IS NULL OR (scope <> 'ANY' AND scope <> agreement_model) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: % → % interdite',
      NEW.from_status, NEW.to_status;
  END IF;
  IF NEW.from_status = 'DRAFT' AND NEW.to_status = 'ACTIVE' THEN
    -- Marchand défaillant, ou version d'offre antérieure à un incident
    -- (même levé) : le prix figé ne l'engage plus.
    SELECT COALESCE(s.in_default, false) OR EXISTS (
      SELECT 1 FROM catalog.partner_incident i
      JOIN catalog.offer_version ov
        ON ov.offer_id = a.offer_id AND ov.version = a.offer_version
      WHERE i.partner_id = a.partner_id
        AND i.kind = 'MERCHANT_DEFAULT'
        AND i.created_at > ov.created_at
    ) INTO partner_defaulted
    FROM agreements.agreement a
    LEFT JOIN catalog.partner_state s ON s.partner_id = a.partner_id
    WHERE a.id = NEW.agreement_id;
    IF partner_defaulted THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: marchand défaillant, activation refusée';
    END IF;
  END IF;
  IF NEW.to_status = 'CANCELLED_BY_CUSTOMER' AND is_locked THEN
    RAISE EXCEPTION 'AGREEMENT_LOCKED: objectif verrouillé, annulation refusée';
  END IF;
  IF NEW.from_status = 'DISPUTED' AND NEW.to_status <> 'REFUNDED' THEN
    SELECT e.from_status INTO dispute_origin
    FROM agreements.status_event e
    WHERE e.agreement_id = NEW.agreement_id
      AND e.kind = 'TRANSITION' AND e.to_status = 'DISPUTED'
    ORDER BY e.seq DESC LIMIT 1;
    IF dispute_origin IS DISTINCT FROM NEW.to_status THEN
      RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: un litige ne revient qu’à %', dispute_origin;
    END IF;
  END IF;
  -- FUNDED : 100 % de la cible versés et confirmés au grand livre (I-6, I-9).
  IF NEW.to_status = 'FUNDED' THEN
    SELECT a.target_xaf INTO target FROM agreements.agreement a WHERE a.id = NEW.agreement_id;
    IF agreements.confirmed_funds_xaf(NEW.agreement_id) < target THEN
      RAISE EXCEPTION 'AGREEMENT_LEDGER_LINK_REQUIRED: FUNDED exige 100 %% de la cible au grand livre';
    END IF;
  END IF;
  IF NEW.to_status IN ('HANDED_OVER', 'PAID_TO_BENEFICIARY', 'REFUNDED') THEN
    RAISE EXCEPTION 'AGREEMENT_LEDGER_LINK_REQUIRED: % exige une écriture du grand livre',
      NEW.to_status;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION agreements.assert_status_event() FROM PUBLIC;

COMMIT;
