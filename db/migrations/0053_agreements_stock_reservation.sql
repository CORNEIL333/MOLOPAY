-- Migration 0053 — réservation du stock à l'activation (F-CAT-005, D57).
-- Dépend de 0009 (catalog.offer_version), 0011 et 0039 (agreements).
--
-- Un article en stock est réservé quand l'accord devient ACTIVE (engagement
-- signé), pas au brouillon (qui ne doit pas pouvoir épuiser le stock). La
-- réservation est dérivée des états : un accord ACTIVE, FUNDED, DISPUTED ou
-- FROZEN d'une offre retient une unité ; l'annulation et le remboursement la
-- libèrent d'eux-mêmes. Le stock déclaré par la dernière version publiée de
-- l'offre compte les unités présentes en boutique à sa date : une remise
-- postérieure à cette version en retire une. Les offres en précommande ne
-- sont pas limitées (délai de mise à disposition).
-- Disponible = stock déclaré − réservations − remises depuis la version ;
-- sous verrou consultatif par offre (deux activations concurrentes ne
-- prennent pas la même unité).

BEGIN;

CREATE FUNCTION agreements.assert_stock_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_offer uuid;
  declared_kind text;
  declared_units integer;
  declared_at timestamptz;
  reserved integer;
  handed_since integer;
BEGIN
  IF NEW.kind <> 'TRANSITION' OR NEW.from_status <> 'DRAFT' OR NEW.to_status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  SELECT a.offer_id INTO agreement_offer FROM agreements.agreement a WHERE a.id = NEW.agreement_id;
  IF agreement_offer IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog.stock:' || agreement_offer::text, 0));
  SELECT v.availability_kind, v.stock_units, v.created_at INTO declared_kind, declared_units, declared_at
  FROM catalog.offer_version v
  WHERE v.offer_id = agreement_offer AND v.state = 'PUBLISHED'
  ORDER BY v.version DESC LIMIT 1;
  IF declared_kind IS NULL THEN
    RAISE EXCEPTION 'CATALOG_OFFER_NOT_PUBLISHED: offre sans version publiée';
  END IF;
  IF declared_kind <> 'IN_STOCK' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO reserved
  FROM agreements.agreement a JOIN agreements.agreement_state s ON s.id = a.id
  WHERE a.offer_id = agreement_offer AND a.id <> NEW.agreement_id
    AND s.status IN ('ACTIVE', 'FUNDED', 'DISPUTED', 'FROZEN');
  SELECT count(*) INTO handed_since
  FROM agreements.agreement a JOIN agreements.status_event e ON e.agreement_id = a.id
  WHERE a.offer_id = agreement_offer
    AND e.kind = 'TRANSITION' AND e.to_status = 'HANDED_OVER' AND e.created_at > declared_at;
  IF declared_units - reserved - handed_since < 1 THEN
    RAISE EXCEPTION 'CATALOG_STOCK_UNAVAILABLE: stock épuisé (% déclarés, % réservés, % remis depuis)',
      declared_units, reserved, handed_since;
  END IF;
  RETURN NEW;
END $$;

-- F-CAT-005 : unités encore disponibles d'une offre (null si précommande ou non publiée).
CREATE FUNCTION agreements.available_stock(p_offer uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN v.availability_kind = 'IN_STOCK' THEN
    v.stock_units
    - (SELECT count(*)::integer FROM agreements.agreement a JOIN agreements.agreement_state s ON s.id = a.id
        WHERE a.offer_id = p_offer AND s.status IN ('ACTIVE', 'FUNDED', 'DISPUTED', 'FROZEN'))
    - (SELECT count(*)::integer FROM agreements.agreement a JOIN agreements.status_event e ON e.agreement_id = a.id
        WHERE a.offer_id = p_offer AND e.kind = 'TRANSITION' AND e.to_status = 'HANDED_OVER' AND e.created_at > v.created_at)
  END
  FROM catalog.offer_version v
  WHERE v.offer_id = p_offer AND v.state = 'PUBLISHED'
  ORDER BY v.version DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION agreements.assert_stock_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.available_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agreements.available_stock(uuid) TO app_rw, app_ro;

CREATE TRIGGER status_event_stock_reservation BEFORE INSERT ON agreements.status_event
  FOR EACH ROW EXECUTE FUNCTION agreements.assert_stock_reservation();
ALTER TABLE agreements.status_event ENABLE ALWAYS TRIGGER status_event_stock_reservation;

COMMIT;
