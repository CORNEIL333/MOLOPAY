-- Migration 0049 — alertes de fraude et décisions tracées (SEC-FRD-001/002,
-- lot 16, D53). Aucune dépendance de schéma métier : les faits sont lus par
-- l'application dans chaque module, évalués par des règles pures, puis
-- l'alerte et ses preuves sont écrites ici.
--
-- Une seule alerte ouverte (sans décision) par règle et par sujet ; la
-- décision est tracée (motif obligatoire) et n'applique aucune sanction
-- (SEC-FRD-002 : aucune sanction automatique irréversible).

BEGIN;

CREATE SCHEMA risk;
REVOKE ALL ON SCHEMA risk FROM PUBLIC;
GRANT USAGE ON SCHEMA risk TO app_rw, app_ro;

CREATE TABLE risk.alert (
  id uuid PRIMARY KEY,
  rule text NOT NULL CHECK (rule IN ('PAYMENT_VELOCITY', 'REPEATED_CANCELLATIONS', 'HANDOVER_SPIKE')),
  subject_type text NOT NULL CHECK (subject_type IN ('CUSTOMER', 'PARTNER')),
  subject_id text NOT NULL CHECK (subject_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  detected_by text NOT NULL CHECK (length(detected_by) BETWEEN 1 AND 200 AND detected_by !~ '[[:space:]]'),
  detected_at timestamptz NOT NULL,
  CONSTRAINT alert_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT alert_rule_subject CHECK (
    (rule IN ('PAYMENT_VELOCITY', 'REPEATED_CANCELLATIONS') AND subject_type = 'CUSTOMER')
    OR (rule = 'HANDOVER_SPIKE' AND subject_type = 'PARTNER')
  )
);
CREATE INDEX alert_rule_subject_idx ON risk.alert (rule, subject_type, subject_id);

CREATE TABLE risk.alert_decision (
  alert_id uuid PRIMARY KEY REFERENCES risk.alert (id),
  decision text NOT NULL CHECK (decision IN ('DISMISSED', 'CONFIRMED')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  decided_at timestamptz NOT NULL
);

CREATE FUNCTION risk.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RISK_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE FUNCTION risk.anchor_alert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  keys text[];
  ids jsonb;
BEGIN
  -- Preuves explicables, de forme fixe : faits comptés, fenêtre, seuil.
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(NEW.evidence) AS k;
  ids := NEW.evidence -> 'eventIds';
  IF keys IS DISTINCT FROM ARRAY['count', 'eventIds', 'maxCount', 'windowEnd', 'windowMinutes', 'windowStart']::text[]
     OR jsonb_typeof(ids) <> 'array'
     OR jsonb_typeof(NEW.evidence -> 'count') <> 'number'
     OR jsonb_typeof(NEW.evidence -> 'maxCount') <> 'number'
     OR (NEW.evidence ->> 'count')::numeric <> jsonb_array_length(ids)
     OR (NEW.evidence ->> 'count')::numeric <= (NEW.evidence ->> 'maxCount')::numeric THEN
    RAISE EXCEPTION 'RISK_INVALID_REQUEST: preuves de l’alerte incomplètes ou incohérentes';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('risk.alert:' || NEW.rule || ':' || NEW.subject_id, 0));
  IF EXISTS (
    SELECT 1 FROM risk.alert a
    WHERE a.rule = NEW.rule AND a.subject_type = NEW.subject_type AND a.subject_id = NEW.subject_id
      AND NOT EXISTS (SELECT 1 FROM risk.alert_decision d WHERE d.alert_id = a.id)
  ) THEN
    RAISE EXCEPTION 'RISK_ALERT_OPEN: une alerte % est déjà ouverte pour ce sujet', NEW.rule;
  END IF;
  NEW.detected_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION risk.anchor_alert_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.decided_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION risk.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION risk.anchor_alert() FROM PUBLIC;
REVOKE ALL ON FUNCTION risk.anchor_alert_decision() FROM PUBLIC;

CREATE TRIGGER alert_anchor BEFORE INSERT ON risk.alert
  FOR EACH ROW EXECUTE FUNCTION risk.anchor_alert();
CREATE TRIGGER alert_decision_anchor BEFORE INSERT ON risk.alert_decision
  FOR EACH ROW EXECUTE FUNCTION risk.anchor_alert_decision();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert', 'alert_decision'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON risk.%I FOR EACH ROW EXECUTE FUNCTION risk.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON risk.%I FOR EACH STATEMENT EXECUTE FUNCTION risk.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE risk.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE risk.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('ALTER TABLE risk.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('GRANT SELECT, INSERT ON risk.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON risk.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON risk.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;

COMMIT;
