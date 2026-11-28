-- Migration 0052 — clôture des réclamations, délai de réponse, règlement
-- débloqué par la clôture (lot 15 : F-SUP-001/002, D41, D46, D56).
-- Dépend de 0032 (disputes) et 0041 (settlement.anchor_payout).
--
-- Clôture : issue en liste fermée (répondue, retirée), sans texte libre
-- (D41 : aucune donnée personnelle), refusée tant qu'un litige ouvert sur la
-- réclamation n'est pas levé. Délai : réclamations non closes reçues depuis
-- plus de 15 jours (cible R-2020/06 retenue en D41, ⚖), avec indication du
-- dépassement du maximum de 45 jours.
-- Écart D46 : une réclamation reçue après la remise ne bloque plus le
-- règlement que tant qu'elle n'est pas close. La fonction de 0041 est reprise
-- à l'identique, seule la condition de blocage change.

BEGIN;

CREATE TABLE disputes.complaint_closure (
  complaint_id uuid PRIMARY KEY REFERENCES disputes.complaint (id),
  outcome text NOT NULL CHECK (outcome IN ('ANSWERED', 'WITHDRAWN')),
  closed_by text NOT NULL CHECK (length(closed_by) BETWEEN 1 AND 200 AND closed_by !~ '[[:space:]]'),
  closed_at timestamptz NOT NULL
);

CREATE FUNCTION disputes.anchor_complaint_closure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM disputes.dispute d
    WHERE d.complaint_id = NEW.complaint_id
      AND NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)
  ) THEN
    RAISE EXCEPTION 'DISPUTE_OPEN: litige ouvert sur cette réclamation, à lever avant la clôture';
  END IF;
  NEW.closed_at := clock_timestamp();
  RETURN NEW;
END $$;

-- F-SUP-001 / D41 : réclamations non closes au-delà du délai cible de réponse.
CREATE FUNCTION disputes.overdue_complaints(p_at timestamptz)
RETURNS TABLE (complaint_id uuid, reference text, received_at timestamptz, beyond_maximum boolean)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.reference, c.received_at, p_at - c.received_at > interval '45 days'
  FROM disputes.complaint c
  WHERE NOT EXISTS (SELECT 1 FROM disputes.complaint_closure x WHERE x.complaint_id = c.id)
    AND p_at - c.received_at > interval '15 days'
  ORDER BY c.received_at
$$;

REVOKE ALL ON FUNCTION disputes.anchor_complaint_closure() FROM PUBLIC;
REVOKE ALL ON FUNCTION disputes.overdue_complaints(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION disputes.overdue_complaints(timestamptz) TO app_rw, app_ro;

CREATE TRIGGER complaint_closure_anchor BEFORE INSERT ON disputes.complaint_closure
  FOR EACH ROW EXECUTE FUNCTION disputes.anchor_complaint_closure();
CREATE TRIGGER complaint_closure_no_update_delete BEFORE UPDATE OR DELETE ON disputes.complaint_closure
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER complaint_closure_no_truncate BEFORE TRUNCATE ON disputes.complaint_closure
  FOR EACH STATEMENT EXECUTE FUNCTION disputes.forbid_mutation();
ALTER TABLE disputes.complaint_closure ENABLE ALWAYS TRIGGER complaint_closure_anchor;
ALTER TABLE disputes.complaint_closure ENABLE ALWAYS TRIGGER complaint_closure_no_update_delete;
ALTER TABLE disputes.complaint_closure ENABLE ALWAYS TRIGGER complaint_closure_no_truncate;
GRANT SELECT, INSERT ON disputes.complaint_closure TO app_rw;
GRANT SELECT ON disputes.complaint_closure TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON disputes.complaint_closure FROM app_rw, app_ro;

-- D46 / D56 : reprise de settlement.anchor_payout (0041), blocage limité aux réclamations non closes.
CREATE OR REPLACE FUNCTION settlement.anchor_payout() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bps integer;
  window_days integer;
  handed_at timestamptz;
  handover_partner text;
  target bigint;
BEGIN
  bps := settlement.integer_setting('merchant_commission_bps', 0, 10000);
  window_days := settlement.integer_setting('settlement_contestation_days', 0, 60);
  IF bps IS NULL OR window_days IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_SETTINGS_NOT_CONFIGURED: commission ou délai de contestation non publiés';
  END IF;
  SELECT h.used_at, h.partner_id, a.target_xaf INTO handed_at, handover_partner, target
  FROM settlement.handover h
  JOIN agreements.agreement a ON a.id = h.agreement_id
  WHERE h.agreement_id = NEW.agreement_id;
  IF handed_at IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_INVALID_REQUEST: aucune remise pour cet accord';
  END IF;
  IF handed_at + make_interval(days => window_days) > clock_timestamp() THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_DUE: délai de contestation de % jours non écoulé', window_days;
  END IF;
  IF EXISTS (
    SELECT 1 FROM disputes.complaint c
    WHERE c.agreement_id = NEW.agreement_id AND c.received_at >= handed_at
      AND NOT EXISTS (SELECT 1 FROM disputes.complaint_closure x WHERE x.complaint_id = c.id)
  ) THEN
    RAISE EXCEPTION 'SETTLEMENT_BLOCKED: réclamation non close reçue depuis la remise';
  END IF;
  NEW.partner_id := handover_partner;
  NEW.gross_xaf := target;
  NEW.commission_bps := bps;
  NEW.commission_xaf := (target * bps * 2 + 10000) / 20000;
  NEW.net_xaf := target - NEW.commission_xaf;
  NEW.prepared_at := clock_timestamp();
  RETURN NEW;
END $$;

COMMIT;
