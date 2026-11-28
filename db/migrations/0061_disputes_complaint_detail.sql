-- Migration 0061 — motif et description d'une réclamation ouverte par le
-- client (F-SUP-001, D70). Dépend de 0032 (disputes.complaint).
--
-- Un seul détail par réclamation, en ajout seul. Le texte est celui du client
-- (10 à 1000 caractères, sans caractère de contrôle) ; il peut contenir des
-- données personnelles et n'est jamais journalisé ni notifié.

BEGIN;

CREATE TABLE disputes.complaint_detail (
  complaint_id uuid PRIMARY KEY REFERENCES disputes.complaint (id),
  reason text NOT NULL CHECK (reason IN ('PAYMENT_NOT_RECEIVED', 'HANDOVER_REFUSED', 'OFFER_MISMATCH', 'OTHER')),
  details text NOT NULL CHECK (length(btrim(details)) BETWEEN 10 AND 1000 AND details !~ '[[:cntrl:]]'),
  recorded_at timestamptz NOT NULL
);

CREATE FUNCTION disputes.anchor_complaint_detail() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER complaint_detail_anchor BEFORE INSERT ON disputes.complaint_detail
  FOR EACH ROW EXECUTE FUNCTION disputes.anchor_complaint_detail();
CREATE TRIGGER complaint_detail_no_update_delete BEFORE UPDATE OR DELETE ON disputes.complaint_detail
  FOR EACH ROW EXECUTE FUNCTION disputes.forbid_mutation();
CREATE TRIGGER complaint_detail_no_truncate BEFORE TRUNCATE ON disputes.complaint_detail
  FOR EACH STATEMENT EXECUTE FUNCTION disputes.forbid_mutation();
ALTER TABLE disputes.complaint_detail ENABLE ALWAYS TRIGGER complaint_detail_anchor;
ALTER TABLE disputes.complaint_detail ENABLE ALWAYS TRIGGER complaint_detail_no_update_delete;
ALTER TABLE disputes.complaint_detail ENABLE ALWAYS TRIGGER complaint_detail_no_truncate;
REVOKE ALL ON FUNCTION disputes.anchor_complaint_detail() FROM PUBLIC;
GRANT SELECT, INSERT ON disputes.complaint_detail TO app_rw;
GRANT SELECT ON disputes.complaint_detail TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON disputes.complaint_detail FROM app_rw, app_ro;

COMMIT;
