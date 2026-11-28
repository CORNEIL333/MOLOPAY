-- Migration 0027 — confirmation d'une tentative liée au grand livre
-- (lot 11, tranche 2 : F-SAV-002, F-PAY-002/004, INT-IDEM-002, INT-LED-006/008).
-- Dépend de 0001 (ledger), 0011 (agreements) et 0026 (payments).
--
-- Une confirmation = trois lignes écrites dans la même transaction (I-6) :
--   1. l'écriture PAYMENT_CONFIRMED du grand livre : débit 1200 (créance sur
--      l'agrégateur), crédit 2100 du client (CDC_04 § 2.2) ;
--   2. la contribution, qui relie tentative, transaction du prestataire et
--      écriture ;
--   3. la transition PENDING → CONFIRMED.
-- La base refuse chacune sans les deux autres. Les espèces restent hors de ce
-- chemin (D39) ; les remboursements restent refusés (lot 12).

BEGIN;

CREATE TABLE payments.contribution (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES payments.payment_attempt (id),
  channel text NOT NULL CHECK (channel IN ('MTN_MOMO', 'ORANGE_MONEY', 'CARD')),
  provider_tx_id text NOT NULL CHECK (provider_tx_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  customer_id uuid NOT NULL,
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  entry_id uuid NOT NULL UNIQUE REFERENCES ledger.journal_entry (id),
  confirmed_at timestamptz NOT NULL,
  CONSTRAINT contribution_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  -- INT-IDEM-002 : une transaction du prestataire ne crédite qu'une fois.
  CONSTRAINT contribution_provider_tx_unique UNIQUE (channel, provider_tx_id)
);

-- La contribution doit correspondre exactement à la tentative, à l'accord et
-- à une écriture PAYMENT_CONFIRMED 1200 → 2100 du client, du même montant.
CREATE FUNCTION payments.assert_contribution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  attempt_channel text;
  attempt_amount bigint;
  attempt_agreement uuid;
  agreement_customer uuid;
  current_status text;
  entry_type text;
  entry_attempt text;
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

  SELECT operation_type, business_refs ->> 'payment_attempt_id'
    INTO entry_type, entry_attempt
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
     OR line_count <> 2
     OR aggregator_debit <> NEW.amount_xaf
     OR client_credit <> NEW.amount_xaf THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LINK_REQUIRED: écriture non conforme à la confirmation';
  END IF;
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Pas d'écriture sans état : à la validation, la tentative est CONFIRMED.
CREATE FUNCTION payments.assert_contribution_confirmed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM payments.attempt_event
    WHERE attempt_id = NEW.attempt_id AND to_status = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'PAYMENT_CONFIRMATION_INCOMPLETE: contribution sans transition CONFIRMED';
  END IF;
  RETURN NULL;
END $$;

-- Pas d'état sans écriture : CONFIRMED exige la contribution de la tentative.
CREATE OR REPLACE FUNCTION payments.assert_attempt_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest_seq integer;
  current_status text;
BEGIN
  SELECT max(seq) INTO latest_seq
  FROM payments.attempt_event WHERE attempt_id = NEW.attempt_id;
  IF NEW.seq <> COALESCE(latest_seq, 0) + 1 THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_REQUEST: séquence % attendue, % reçue',
      COALESCE(latest_seq, 0) + 1, NEW.seq;
  END IF;
  SELECT e.to_status INTO current_status
  FROM payments.attempt_event e
  WHERE e.attempt_id = NEW.attempt_id AND e.seq = latest_seq;
  current_status := COALESCE(current_status, 'CREATED');
  IF NEW.from_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: état courant %, reçu %',
      current_status, NEW.from_status;
  END IF;
  IF (NEW.from_status || '>' || NEW.to_status) NOT IN (
    'CREATED>PENDING',
    'PENDING>CONFIRMED',
    'PENDING>FAILED',
    'PENDING>EXPIRED',
    'CONFIRMED>REFUND_PENDING',
    'REFUND_PENDING>REFUNDED'
  ) THEN
    IF NEW.from_status = 'CONFIRMED' THEN
      RAISE EXCEPTION 'PAYMENT_ALREADY_CONFIRMED: CONFIRMED → % interdite', NEW.to_status;
    END IF;
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: % → % interdite',
      NEW.from_status, NEW.to_status;
  END IF;
  IF NEW.to_status = 'CONFIRMED' AND NOT EXISTS (
    SELECT 1 FROM payments.contribution WHERE attempt_id = NEW.attempt_id
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LINK_REQUIRED: CONFIRMED exige une écriture du grand livre';
  END IF;
  IF NEW.to_status IN ('REFUND_PENDING', 'REFUNDED') THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LINK_REQUIRED: % exige une écriture du grand livre (lot 12)',
      NEW.to_status;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- D39 (option prudente) : une tentative ne dépasse pas le reste dû, calculé
-- à partir des versements confirmés. Une tentative concurrente encore en
-- attente n'est pas comptée : le trop-perçu reste possible et sera traité
-- par remboursement (lot 12).
CREATE OR REPLACE FUNCTION payments.anchor_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_status text;
  target bigint;
  confirmed bigint;
BEGIN
  SELECT status INTO agreement_status
  FROM agreements.agreement_state WHERE id = NEW.agreement_id;
  IF agreement_status IS NOT NULL AND agreement_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'PAYMENT_AGREEMENT_NOT_ACTIVE: accord à l’état %', agreement_status;
  END IF;
  SELECT target_xaf INTO target FROM agreements.agreement WHERE id = NEW.agreement_id;
  SELECT COALESCE(sum(c.amount_xaf), 0) INTO confirmed
  FROM payments.contribution c
  JOIN payments.payment_attempt a ON a.id = c.attempt_id
  WHERE a.agreement_id = NEW.agreement_id;
  IF target IS NOT NULL AND NEW.amount_xaf > target - confirmed THEN
    RAISE EXCEPTION 'PAYMENT_EXCEEDS_REMAINING: reste dû %', target - confirmed;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION payments.assert_contribution() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.assert_contribution_confirmed() FROM PUBLIC;

CREATE TRIGGER contribution_assert
  BEFORE INSERT ON payments.contribution
  FOR EACH ROW EXECUTE FUNCTION payments.assert_contribution();
CREATE CONSTRAINT TRIGGER contribution_confirmed
  AFTER INSERT ON payments.contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payments.assert_contribution_confirmed();
CREATE TRIGGER contribution_no_update_delete
  BEFORE UPDATE OR DELETE ON payments.contribution
  FOR EACH ROW EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER contribution_no_truncate
  BEFORE TRUNCATE ON payments.contribution
  FOR EACH STATEMENT EXECUTE FUNCTION payments.forbid_mutation();

ALTER TABLE payments.contribution ENABLE ALWAYS TRIGGER contribution_assert;
ALTER TABLE payments.contribution ENABLE ALWAYS TRIGGER contribution_confirmed;
ALTER TABLE payments.contribution ENABLE ALWAYS TRIGGER contribution_no_update_delete;
ALTER TABLE payments.contribution ENABLE ALWAYS TRIGGER contribution_no_truncate;

GRANT SELECT, INSERT ON payments.contribution TO app_rw;
GRANT SELECT ON payments.contribution TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON payments.contribution FROM app_rw, app_ro;

COMMIT;
