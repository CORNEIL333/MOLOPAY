-- Migration 0036 — plafonds par niveau KYC sur les tentatives de paiement
-- (D43, REG-LBC-001). Dépend de 0003 (admin), 0004 (identity), 0027 (payments).
--
-- Plafonds lus dans le paramètre versionné « kyc_limits » (admin.setting_version,
-- publié après demande FINANCIAL_SETTING approuvée), forme :
--   {"levels": {"BASIC":  {"holding_xaf": "…", "monthly_xaf": "…"},
--               "STRONG": {"holding_xaf": "…", "monthly_xaf": "…"}}}
-- BASIC = niveau 1 (numéro vérifié + nom) ; STRONG = niveau 2 (pièce + selfie).
-- Le niveau 3 (adresse + origine des fonds) n'existe pas encore (lot 07) :
-- au-delà du plafond STRONG, refus avec « niveau ENHANCED requis ».
-- Fermé par défaut : sans paramètre publié, ou client sans niveau, refus.
-- Fonction reprise de 0027 à l'identique, plus ce contrôle.

BEGIN;

GRANT SELECT ON admin.setting_version TO app_rw;

CREATE OR REPLACE FUNCTION payments.anchor_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_status text;
  target bigint;
  confirmed bigint;
  customer uuid;
  level text;
  limits jsonb;
  holding bigint;
  monthly bigint;
  pending bigint;
  required text;
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
  -- D43 / REG-LBC-001 : plafonds par niveau KYC, paramètre versionné
  -- approuvé en maker-checker (admin.setting_version « kyc_limits »).
  -- Fermé par défaut : sans paramètre publié, aucun versement.
  SELECT s.value INTO limits
  FROM admin.setting_version s
  WHERE s.key = 'kyc_limits'
  ORDER BY s.version DESC LIMIT 1;
  IF limits IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_KYC_LIMITS_NOT_CONFIGURED: aucun plafond KYC publié';
  END IF;
  SELECT a.customer_id INTO customer FROM agreements.agreement a WHERE a.id = NEW.agreement_id;
  IF customer IS NULL THEN
    -- Accord inconnu : la clé étrangère le refusera (23503).
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  SELECT i.kyc_level INTO level FROM identity.account i WHERE i.id = customer;
  level := COALESCE(level, 'NONE');
  -- Fonds détenus : solde 2100 du client (dérivé du grand livre, I-9).
  SELECT COALESCE(sum(b.credit_total_xaf - b.debit_total_xaf), 0) INTO holding
  FROM ledger.account_balance b
  WHERE b.code = '2100' AND b.owner_type = 'CLIENT' AND b.owner_id = customer;
  -- Tentatives encore ouvertes du client : comptées d'avance (prudence).
  SELECT COALESCE(sum(t.amount_xaf), 0) INTO pending
  FROM payments.payment_attempt t
  JOIN agreements.agreement a ON a.id = t.agreement_id
  JOIN payments.attempt_state st ON st.id = t.id
  WHERE a.customer_id = customer AND st.status IN ('CREATED', 'PENDING');
  -- Versements confirmés ce mois civil, heure de Douala.
  SELECT COALESCE(sum(c.amount_xaf), 0) INTO monthly
  FROM payments.contribution c
  WHERE c.customer_id = customer
    AND date_trunc('month', c.confirmed_at AT TIME ZONE 'Africa/Douala')
      = date_trunc('month', clock_timestamp() AT TIME ZONE 'Africa/Douala');
  holding := holding + pending + NEW.amount_xaf;
  monthly := monthly + pending + NEW.amount_xaf;
  IF level NOT IN ('BASIC', 'STRONG')
     OR limits #>> ARRAY['levels', level, 'holding_xaf'] IS NULL
     OR holding > (limits #>> ARRAY['levels', level, 'holding_xaf'])::bigint
     OR monthly > (limits #>> ARRAY['levels', level, 'monthly_xaf'])::bigint THEN
    required := CASE
      WHEN holding <= (limits #>> ARRAY['levels', 'BASIC', 'holding_xaf'])::bigint
       AND monthly <= (limits #>> ARRAY['levels', 'BASIC', 'monthly_xaf'])::bigint THEN 'BASIC'
      WHEN holding <= (limits #>> ARRAY['levels', 'STRONG', 'holding_xaf'])::bigint
       AND monthly <= (limits #>> ARRAY['levels', 'STRONG', 'monthly_xaf'])::bigint THEN 'STRONG'
      ELSE 'ENHANCED'
    END;
    RAISE EXCEPTION 'PAYMENT_KYC_LIMIT_EXCEEDED: niveau % requis', required;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION payments.anchor_attempt() FROM PUBLIC;

COMMIT;
