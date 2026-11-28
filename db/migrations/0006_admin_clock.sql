-- 0003 est déjà appliquée. Les horodatages de préparation et de décision sont
-- déclarés par l'appelant : sans ancrage, un décideur peut antidater sa
-- décision pour approuver après expiration. On conserve la durée de validité
-- demandée (bornée à 7 jours comme le domaine) mais on ancre les bornes sur
-- l'horloge murale du serveur. clock_timestamp() est requis : now() renvoie
-- l'heure de début de transaction, qu'un appelant peut étirer avant l'INSERT.
BEGIN;

CREATE FUNCTION admin.anchor_request_clock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  declared_lifetime interval;
BEGIN
  declared_lifetime := NEW.expires_at - NEW.prepared_at;
  IF declared_lifetime <= interval '0' THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: durée de validité non positive';
  END IF;
  IF declared_lifetime > interval '7 days' THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: durée de validité supérieure à sept jours';
  END IF;
  NEW.prepared_at := clock_timestamp();
  NEW.expires_at := NEW.prepared_at + declared_lifetime;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION admin.anchor_request_clock() FROM PUBLIC;

CREATE TRIGGER approval_request_clock
  BEFORE INSERT ON admin.approval_request
  FOR EACH ROW EXECUTE FUNCTION admin.anchor_request_clock();

ALTER TABLE admin.approval_request ENABLE ALWAYS TRIGGER approval_request_clock;

CREATE OR REPLACE FUNCTION admin.assert_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_maker text;
  request_expires timestamptz;
BEGIN
  SELECT maker_id, expires_at INTO request_maker, request_expires
  FROM admin.approval_request
  WHERE id = NEW.request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: demande % absente', NEW.request_id;
  END IF;
  NEW.decided_at := clock_timestamp();
  IF NEW.decided_at >= request_expires THEN
    RAISE EXCEPTION 'ADMIN_REQUEST_EXPIRED: demande % expirée', NEW.request_id;
  END IF;
  IF NEW.decision = 'CANCELLED' THEN
    IF NEW.decided_by <> request_maker THEN
      RAISE EXCEPTION 'ADMIN_FORBIDDEN: annulation réservée au préparateur';
    END IF;
  ELSE
    IF NEW.decided_by = request_maker THEN
      RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le préparateur ne peut pas décider';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
