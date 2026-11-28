-- Migration 0034 — accords adossés au registre des plans, durée en mois
-- (D26 tranche 2, D27). Dépend de 0011, 0015 et 0033.
--
-- Un accord ne s'insère que si son plan est inscrit au registre des plans
-- approuvés (0033) avec le même modèle, le même rythme et le même minimum,
-- et si sa durée, désormais en MOIS (1 à 36), ne dépasse pas celle du plan.
-- duration_days reste pour l'historique mais n'est plus accepté à l'insertion.
-- La fonction d'ancrage reprend 0015 à l'identique, plus ces contrôles.

BEGIN;

ALTER TABLE agreements.agreement
  ADD COLUMN duration_months integer CHECK (duration_months BETWEEN 1 AND 36);
ALTER TABLE agreements.agreement ALTER COLUMN duration_days DROP NOT NULL;
ALTER TABLE agreements.agreement ADD CONSTRAINT agreement_duration_one_unit CHECK (
  (duration_days IS NULL) <> (duration_months IS NULL)
);

GRANT SELECT ON catalog.payment_plan TO app_rw, app_ro;

CREATE OR REPLACE FUNCTION agreements.anchor_agreement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_version integer;
  version_price bigint;
  version_state text;
  version_models text[];
  owner text;
  owner_status text;
  owner_in_default boolean;
  beneficiary_status text;
  beneficiary_type text;
  plan_model text;
  plan_rhythm text;
  plan_min bigint;
  plan_max integer;
BEGIN
  IF NEW.model = 'SAVE_THEN_BUY' THEN
    SELECT max(version) INTO current_version
    FROM catalog.offer_version
    WHERE offer_id = NEW.offer_id;
    IF current_version IS DISTINCT FROM NEW.offer_version THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: version % non courante', NEW.offer_version;
    END IF;
    SELECT v.price_xaf, v.state, v.models, o.partner_id, s.status, c.partner_in_default
      INTO version_price, version_state, version_models, owner, owner_status, owner_in_default
    FROM catalog.offer_version v
    JOIN catalog.offer o ON o.id = v.offer_id
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
    LEFT JOIN catalog.offer_current c ON c.offer_id = v.offer_id
    WHERE v.offer_id = NEW.offer_id AND v.version = NEW.offer_version;
    IF version_state IS DISTINCT FROM 'PUBLISHED'
       OR owner_status IS DISTINCT FROM 'VALIDATED'
       OR owner_in_default IS DISTINCT FROM false
       OR NOT ('SAVE_THEN_BUY' = ANY (version_models)) THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: offre indisponible pour le modèle A';
    END IF;
    IF owner IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION 'AGREEMENT_INVALID_REQUEST: partenaire différent de celui de l’offre';
    END IF;
    IF version_price IS DISTINCT FROM NEW.target_xaf THEN
      RAISE EXCEPTION 'AGREEMENT_INVALID_REQUEST: cible différente du prix figé';
    END IF;
  ELSE
    SELECT s.status, s.partner_type INTO beneficiary_status, beneficiary_type
    FROM catalog.partner_state s
    WHERE s.partner_id = NEW.beneficiary_id;
    IF beneficiary_status IS DISTINCT FROM 'VALIDATED'
       OR beneficiary_type IS DISTINCT FROM 'BENEFICIARY' THEN
      RAISE EXCEPTION 'AGREEMENT_BENEFICIARY_NOT_VERIFIED: bénéficiaire % non vérifié',
        NEW.beneficiary_id;
    END IF;
  END IF;
  -- D26/D27 : plan inscrit au registre (maker-checker), conditions identiques,
  -- durée en mois dans la limite du plan. Les jours ne sont plus acceptés.
  SELECT p.model, p.rhythm, p.min_amount_xaf, p.max_duration_months
    INTO plan_model, plan_rhythm, plan_min, plan_max
  FROM catalog.payment_plan p WHERE p.id = NEW.plan_id;
  IF NOT FOUND
     OR plan_model IS DISTINCT FROM NEW.model
     OR plan_rhythm IS DISTINCT FROM NEW.rhythm
     OR plan_min IS DISTINCT FROM NEW.min_amount_xaf THEN
    RAISE EXCEPTION 'AGREEMENT_PLAN_MISMATCH: plan % absent ou conditions différentes', NEW.plan_id;
  END IF;
  IF NEW.duration_days IS NOT NULL
     OR NEW.duration_months IS NULL
     OR NEW.duration_months > plan_max THEN
    RAISE EXCEPTION 'AGREEMENT_PLAN_MISMATCH: durée hors du plan (% mois au plus)', plan_max;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION agreements.anchor_agreement() FROM PUBLIC;

-- Colonne ajoutée en fin de vue (les vues dépendantes restent valides).
CREATE OR REPLACE VIEW agreements.agreement_state
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.customer_id,
  a.model,
  a.offer_id,
  a.offer_version,
  a.partner_id,
  a.beneficiary_id,
  a.target_xaf::text AS target_xaf,
  a.plan_id,
  a.rhythm,
  a.min_amount_xaf::text AS min_amount_xaf,
  a.duration_days,
  a.refund_policy,
  a.terms_hash,
  a.created_at,
  COALESCE((
    SELECT e.to_status FROM agreements.status_event e
    WHERE e.agreement_id = a.id ORDER BY e.seq DESC LIMIT 1
  ), 'DRAFT') AS status,
  EXISTS (
    SELECT 1 FROM agreements.status_event e
    WHERE e.agreement_id = a.id AND e.kind = 'LOCK'
  ) AS locked,
  a.duration_months
FROM agreements.agreement a;

COMMIT;
