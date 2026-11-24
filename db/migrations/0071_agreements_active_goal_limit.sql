-- Migration 0071 — plafond du nombre d'objectifs actifs par client
-- (NF-SAFE-002, surengagement). Dépend de 0003 (paramètres versionnés), 0011.
--
-- Le plafond est une donnée versionnée (NF-PORT-003) publiée en maker-checker :
-- paramètre `customer_commitment_limits`, valeur `{"max_active_goals": n}`,
-- n entre 1 et 50. Refus par défaut : sans paramètre publié valide, aucune
-- activation. Est compté « actif » tout objectif dont le dernier état est
-- ACTIVE (versements encore attendus) ; l'objectif qui s'active (encore en
-- brouillon à cet instant) s'y ajoute.
-- Le plafond de montant cumulé existe déjà (`kyc_limits`, 0036).

BEGIN;

CREATE FUNCTION agreements.assert_active_goal_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  customer uuid;
  setting jsonb;
  ceiling integer;
  active integer;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'TRANSITION' OR NEW.to_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  SELECT a.customer_id INTO customer FROM agreements.agreement a WHERE a.id = NEW.agreement_id;
  IF customer IS NULL THEN
    RETURN NEW; -- accord inconnu : la clé étrangère le refusera
  END IF;
  SELECT s.value INTO setting FROM admin.setting_version s
   WHERE s.key = 'customer_commitment_limits' ORDER BY s.version DESC LIMIT 1;
  IF setting IS NULL OR jsonb_typeof(setting) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(setting)) <> 1
     OR jsonb_typeof(setting -> 'max_active_goals') <> 'number'
     OR (setting ->> 'max_active_goals') !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'AGREEMENT_LIMITS_NOT_CONFIGURED: plafond d''objectifs actifs non publié';
  END IF;
  ceiling := (setting ->> 'max_active_goals')::integer;
  IF ceiling NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'AGREEMENT_LIMITS_NOT_CONFIGURED: plafond % hors 1–50', ceiling;
  END IF;
  -- Deux activations simultanées du même client : sérialisées.
  PERFORM pg_advisory_xact_lock(hashtextextended('agreements.active-goals:' || customer::text, 0));
  SELECT count(*) INTO active FROM agreements.agreement a
   WHERE a.customer_id = customer
     AND (SELECT e.to_status FROM agreements.status_event e
           WHERE e.agreement_id = a.id ORDER BY e.seq DESC LIMIT 1) = 'ACTIVE';
  IF active + 1 > ceiling THEN
    RAISE EXCEPTION 'AGREEMENT_ACTIVE_LIMIT_REACHED: % objectifs actifs au plus', ceiling;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER status_event_active_goal_limit BEFORE INSERT ON agreements.status_event
  FOR EACH ROW EXECUTE FUNCTION agreements.assert_active_goal_limit();
ALTER TABLE agreements.status_event ENABLE ALWAYS TRIGGER status_event_active_goal_limit;

REVOKE ALL ON FUNCTION agreements.assert_active_goal_limit() FROM PUBLIC;

COMMIT;
