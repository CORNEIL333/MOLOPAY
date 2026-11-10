-- Migration 0028 — l'écriture d'une confirmation référence l'accord payé
-- (lot 11). Dépend de 0027.
-- Les fonds d'un accord sont dérivés des écritures par leur référence
-- agreement_id (0029) : la base exige donc qu'elle soit celle de la tentative,
-- sinon une écriture pourrait financer un autre accord. Reprise de 0027 à
-- l'identique, sauf ce contrôle.

BEGIN;

CREATE OR REPLACE FUNCTION payments.assert_contribution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  attempt_channel text;
  attempt_amount bigint;
  attempt_agreement uuid;
  agreement_customer uuid;
  current_status text;
  entry_type text;
  entry_attempt text;
  entry_agreement text;
  line_count integer;
  aggregator_debit bigint;
  client_credit bigint;
BEGIN
  SELECT channel, amount_xaf, agreement_id
    INTO attempt_channel, attempt_amount, attempt_agreement
  FROM payments.payment_attempt WHERE id = NEW.attempt_id;
  IF attempt_channel IS DISTINCT FROM NEW.channel
     OR attempt_amount IS DISTINCT FROM NEW.amount_xaf THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_REQUEST: contribution différente de la tentative';
  END IF;
  SELECT customer_id INTO agreement_customer
  FROM agreements.agreement WHERE id = attempt_agreement;
  IF agreement_customer IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_REQUEST: client différent de celui de l’accord';
  END IF;
  SELECT status INTO current_status
  FROM payments.attempt_state WHERE id = NEW.attempt_id;
  IF current_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_CONFIRMED: tentative déjà confirmée';
  END IF;
  IF current_status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: tentative à l’état %', current_status;
  END IF;

  SELECT operation_type, business_refs ->> 'payment_attempt_id',
         business_refs ->> 'agreement_id'
    INTO entry_type, entry_attempt, entry_agreement
  FROM ledger.journal_entry WHERE id = NEW.entry_id;
  SELECT
    count(*),
    COALESCE(sum(p.amount_xaf) FILTER (
      WHERE p.direction = 'D' AND a.code = '1200' AND a.owner_type IS NULL), 0),
    COALESCE(sum(p.amount_xaf) FILTER (
      WHERE p.direction = 'C' AND a.code = '2100' AND a.owner_type = 'CLIENT'
        AND a.owner_id = NEW.customer_id), 0)
    INTO line_count, aggregator_debit, client_credit
  FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
  WHERE p.entry_id = NEW.entry_id;
  IF entry_type IS DISTINCT FROM 'PAYMENT_CONFIRMED'
     OR entry_attempt IS DISTINCT FROM NEW.attempt_id::text
     OR entry_agreement IS DISTINCT FROM attempt_agreement::text
     OR line_count <> 2
     OR aggregator_debit <> NEW.amount_xaf
     OR client_credit <> NEW.amount_xaf THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LINK_REQUIRED: écriture non conforme à la confirmation';
  END IF;
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION payments.assert_contribution() FROM PUBLIC;

COMMIT;
