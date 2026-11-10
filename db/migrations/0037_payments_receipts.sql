-- Migration 0037 — reçus numérotés par client (F-PAY-006, D39).
-- Dépend de 0027 (payments.contribution).
--
-- F-PAY-006 exige une numérotation continue vérifiable au grand livre ;
-- AGENTS.md § 8 interdit d'exposer un identifiant séquentiel global (il
-- révélerait le volume d'activité). Décision D39 : numéro continu PAR CLIENT,
-- attribué par la base à la confirmation, accompagné des 8 premiers
-- caractères hexadécimaux de l'empreinte de l'écriture du grand livre.
-- Les confirmations sont sérialisées par le verrou de chaîne du grand livre ;
-- l'unicité (client, numéro) reste imposée en filet de sécurité.

BEGIN;

ALTER TABLE payments.contribution ADD COLUMN receipt_no integer CHECK (receipt_no >= 1);
ALTER TABLE payments.contribution ALTER COLUMN receipt_no SET NOT NULL;
ALTER TABLE payments.contribution
  ADD CONSTRAINT contribution_receipt_unique UNIQUE (customer_id, receipt_no);

-- Numéro suivant du client, jamais fourni par l'appelant. Déclencheur nommé
-- pour s'exécuter après contribution_assert (ordre alphabétique).
CREATE FUNCTION payments.number_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT COALESCE(max(c.receipt_no), 0) + 1 INTO NEW.receipt_no
  FROM payments.contribution c
  WHERE c.customer_id = NEW.customer_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION payments.number_receipt() FROM PUBLIC;

CREATE TRIGGER contribution_receipt
  BEFORE INSERT ON payments.contribution
  FOR EACH ROW EXECUTE FUNCTION payments.number_receipt();
ALTER TABLE payments.contribution ENABLE ALWAYS TRIGGER contribution_receipt;

-- Reçu tel que présenté au client (F-PAY-006) : aucun identifiant global.
CREATE VIEW payments.receipt
WITH (security_invoker = true) AS
SELECT
  c.customer_id,
  c.receipt_no,
  c.attempt_id,
  a.agreement_id,
  c.channel,
  c.amount_xaf::text AS amount_xaf,
  c.confirmed_at,
  encode(substring(e.entry_hash FROM 1 FOR 4), 'hex') AS entry_hash_prefix
FROM payments.contribution c
JOIN payments.payment_attempt a ON a.id = c.attempt_id
JOIN ledger.journal_entry e ON e.id = c.entry_id;

GRANT SELECT ON payments.receipt TO app_rw, app_ro;

COMMIT;
