-- Migration 0031 — contrôles du rapprochement sur les liens grand livre ↔
-- paiements (lot 14 : INT-LED-008, INT-REC-005). Dépend de 0027 et 0030.
--
-- `payments` ne peut pas poser de déclencheur sur les tables du grand livre
-- (CDC_05 § 3) : une écriture PAYMENT_CONFIRMED sans contribution n'est donc
-- pas bloquée à l'insertion (D39). Le rapprochement, qui dépend de `ledger`
-- et de `payments`, la détecte. Lecture seule : aucune correction ici.

BEGIN;

-- INT-LED-008 : écriture de confirmation sans contribution (écriture sans état).
CREATE FUNCTION reconciliation.orphan_payment_entries()
RETURNS TABLE (entry_id uuid, seq bigint, recorded_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.seq, e.recorded_at
  FROM ledger.journal_entry e
  WHERE e.operation_type = 'PAYMENT_CONFIRMED'
    AND NOT EXISTS (SELECT 1 FROM payments.contribution c WHERE c.entry_id = e.id)
  ORDER BY e.seq
$$;

-- INT-REC-005 : solde du suspens 2900 (crédits − débits), dérivé des écritures.
CREATE FUNCTION reconciliation.suspense_balance_xaf()
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(b.credit_total_xaf - b.debit_total_xaf), 0)::bigint
  FROM ledger.account_balance b
  WHERE b.code = '2900' AND b.owner_type IS NULL
$$;

REVOKE ALL ON FUNCTION reconciliation.orphan_payment_entries() FROM PUBLIC;
REVOKE ALL ON FUNCTION reconciliation.suspense_balance_xaf() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation.orphan_payment_entries() TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION reconciliation.suspense_balance_xaf() TO app_rw, app_ro;

COMMIT;
