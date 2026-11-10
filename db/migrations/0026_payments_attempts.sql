-- Migration 0026 — tentatives de paiement et anti-rejeu des webhooks
-- (lot 11, tranche 1 : F-PAY-001/002/004, INT-IDEM-001/003/005, SEC-API-002).
-- Dépend de 0011 (agreements.agreement, agreements.agreement_state).
--
-- La tentative est immuable ; son statut est un journal d'événements en ajout
-- seul, limité aux transitions de CDC_05 § 5.1. Les transitions qui supposent
-- un mouvement de fonds (CONFIRMED, REFUND_PENDING, REFUNDED) sont refusées
-- tant que le lien vers l'écriture du grand livre n'existe pas (I-6, tranche 2).
-- Aucun prestataire n'est câblé : le canal décrit le moyen de paiement.

BEGIN;

CREATE SCHEMA IF NOT EXISTS payments;
REVOKE ALL ON SCHEMA payments FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE payments.payment_attempt (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL REFERENCES agreements.agreement (id),
  channel text NOT NULL CHECK (channel IN ('MTN_MOMO', 'ORANGE_MONEY', 'CARD', 'CASH')),
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  -- F-PAY-002 / INT-IDEM-001 : une clé ne crée qu'une tentative.
  idem_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  CONSTRAINT payment_attempt_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE INDEX payment_attempt_agreement_idx ON payments.payment_attempt (agreement_id);

CREATE TABLE payments.attempt_event (
  attempt_id uuid NOT NULL REFERENCES payments.payment_attempt (id),
  seq integer NOT NULL CHECK (seq >= 1),
  from_status text NOT NULL CHECK (from_status IN
    ('CREATED', 'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED')),
  to_status text NOT NULL CHECK (to_status IN
    ('CREATED', 'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED')),
  actor_id text NOT NULL CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND actor_id !~ '[[:space:]]'
  ),
  created_at timestamptz NOT NULL,
  -- Deux messages concurrents calculent la même séquence : un seul passe.
  PRIMARY KEY (attempt_id, seq)
);

-- SEC-API-002 : nonce mémorisé contre le rejeu, horodatage ± 5 min.
-- Le canal tient lieu de source tant que l'agrégateur n'est pas choisi.
CREATE TABLE payments.webhook_receipt (
  channel text NOT NULL CHECK (channel IN ('MTN_MOMO', 'ORANGE_MONEY', 'CARD', 'CASH')),
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9._:-]{8,200}$'),
  signed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (channel, nonce)
);

CREATE FUNCTION payments.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PAYMENT_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- Une tentative ne se crée que sur un accord ACTIVE ; horloge serveur.
CREATE FUNCTION payments.anchor_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_status text;
BEGIN
  SELECT status INTO agreement_status
  FROM agreements.agreement_state WHERE id = NEW.agreement_id;
  IF agreement_status IS NOT NULL AND agreement_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'PAYMENT_AGREEMENT_NOT_ACTIVE: accord à l’état %', agreement_status;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- CDC_05 § 5.1 en liste blanche ; état courant dérivé du journal.
CREATE FUNCTION payments.assert_attempt_event() RETURNS trigger
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
  IF NEW.to_status IN ('CONFIRMED', 'REFUND_PENDING', 'REFUNDED') THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LINK_REQUIRED: % exige une écriture du grand livre',
      NEW.to_status;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION payments.assert_webhook_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.received_at := clock_timestamp();
  IF abs(extract(epoch FROM (NEW.received_at - NEW.signed_at))) > 300 THEN
    RAISE EXCEPTION 'WEBHOOK_TIMESTAMP_OUT_OF_WINDOW: horodatage hors fenêtre';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION payments.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.anchor_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.assert_attempt_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.assert_webhook_receipt() FROM PUBLIC;

CREATE TRIGGER payment_attempt_anchor
  BEFORE INSERT ON payments.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION payments.anchor_attempt();
CREATE TRIGGER attempt_event_assert
  BEFORE INSERT ON payments.attempt_event
  FOR EACH ROW EXECUTE FUNCTION payments.assert_attempt_event();
CREATE TRIGGER webhook_receipt_assert
  BEFORE INSERT ON payments.webhook_receipt
  FOR EACH ROW EXECUTE FUNCTION payments.assert_webhook_receipt();

CREATE TRIGGER payment_attempt_no_update_delete
  BEFORE UPDATE OR DELETE ON payments.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER payment_attempt_no_truncate
  BEFORE TRUNCATE ON payments.payment_attempt
  FOR EACH STATEMENT EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER attempt_event_no_update_delete
  BEFORE UPDATE OR DELETE ON payments.attempt_event
  FOR EACH ROW EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER attempt_event_no_truncate
  BEFORE TRUNCATE ON payments.attempt_event
  FOR EACH STATEMENT EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER webhook_receipt_no_update_delete
  BEFORE UPDATE OR DELETE ON payments.webhook_receipt
  FOR EACH ROW EXECUTE FUNCTION payments.forbid_mutation();
CREATE TRIGGER webhook_receipt_no_truncate
  BEFORE TRUNCATE ON payments.webhook_receipt
  FOR EACH STATEMENT EXECUTE FUNCTION payments.forbid_mutation();

ALTER TABLE payments.payment_attempt ENABLE ALWAYS TRIGGER payment_attempt_anchor;
ALTER TABLE payments.payment_attempt ENABLE ALWAYS TRIGGER payment_attempt_no_update_delete;
ALTER TABLE payments.payment_attempt ENABLE ALWAYS TRIGGER payment_attempt_no_truncate;
ALTER TABLE payments.attempt_event ENABLE ALWAYS TRIGGER attempt_event_assert;
ALTER TABLE payments.attempt_event ENABLE ALWAYS TRIGGER attempt_event_no_update_delete;
ALTER TABLE payments.attempt_event ENABLE ALWAYS TRIGGER attempt_event_no_truncate;
ALTER TABLE payments.webhook_receipt ENABLE ALWAYS TRIGGER webhook_receipt_assert;
ALTER TABLE payments.webhook_receipt ENABLE ALWAYS TRIGGER webhook_receipt_no_update_delete;
ALTER TABLE payments.webhook_receipt ENABLE ALWAYS TRIGGER webhook_receipt_no_truncate;

-- État courant dérivé du journal ; montant exposé en texte.
CREATE VIEW payments.attempt_state
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.agreement_id,
  a.channel,
  a.amount_xaf::text AS amount_xaf,
  a.idem_key,
  a.created_at,
  COALESCE((
    SELECT e.to_status FROM payments.attempt_event e
    WHERE e.attempt_id = a.id ORDER BY e.seq DESC LIMIT 1
  ), 'CREATED') AS status,
  COALESCE((
    SELECT max(e.seq) FROM payments.attempt_event e WHERE e.attempt_id = a.id
  ), 0) AS seq
FROM payments.payment_attempt a;

GRANT USAGE ON SCHEMA payments TO app_rw, app_ro;
GRANT SELECT, INSERT ON payments.payment_attempt, payments.attempt_event,
  payments.webhook_receipt TO app_rw;
GRANT SELECT ON payments.payment_attempt, payments.attempt_event,
  payments.webhook_receipt TO app_ro;
GRANT SELECT ON payments.attempt_state TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON payments.payment_attempt, payments.attempt_event,
  payments.webhook_receipt FROM app_rw, app_ro;

COMMIT;
