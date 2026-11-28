-- Migration 0009 — catalogue : offres versionnées (F-CAT-001, F-PRT-001/002).
-- Dépend de 0008 (catalog.partner_state).
-- Toute modification (prix, stock, publication) crée une version : les accords
-- futurs pourront référencer (offer_id, version) pour figer le prix (F-CAT-003).
-- La publication est refusée en base si le partenaire n'est pas VALIDATED.

BEGIN;

CREATE TABLE catalog.offer (
  id uuid PRIMARY KEY,
  partner_id text NOT NULL
    CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  created_at timestamptz NOT NULL,
  CONSTRAINT offer_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE INDEX offer_partner_idx ON catalog.offer (partner_id);

CREATE TABLE catalog.offer_version (
  offer_id uuid NOT NULL REFERENCES catalog.offer (id),
  version integer NOT NULL CHECK (version >= 1),
  universe text NOT NULL
    CHECK (universe IN ('ESSENTIALS', 'TECHNOLOGY', 'HOUSING', 'MOBILITY')),
  models text[] NOT NULL CHECK (
    cardinality(models) BETWEEN 1 AND 3
    AND models <@ ARRAY['SAVE_THEN_BUY', 'FINANCED_PURCHASE', 'PLANNED_EXPENSE']::text[]
  ),
  city_ids text[] NOT NULL CHECK (
    cardinality(city_ids) BETWEEN 1 AND 2
    AND city_ids <@ ARRAY['yaounde', 'douala']::text[]
  ),
  price_xaf bigint NOT NULL CHECK (price_xaf > 0),
  availability_kind text NOT NULL CHECK (availability_kind IN ('IN_STOCK', 'PREORDER')),
  stock_units integer,
  lead_days integer,
  warranty text NOT NULL
    CHECK (length(btrim(warranty)) >= 1 AND length(warranty) <= 500),
  discount_terms text NOT NULL
    CHECK (length(btrim(discount_terms)) >= 1 AND length(discount_terms) <= 500),
  state text NOT NULL CHECK (state IN ('DRAFT', 'PUBLISHED')),
  created_by text NOT NULL CHECK (
    length(created_by) BETWEEN 1 AND 200 AND created_by !~ '[[:space:]]'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (offer_id, version),
  CONSTRAINT offer_version_availability CHECK (
    (availability_kind = 'IN_STOCK'
      AND stock_units IS NOT NULL AND stock_units >= 0 AND lead_days IS NULL)
    OR (availability_kind = 'PREORDER'
      AND stock_units IS NULL AND lead_days BETWEEN 1 AND 365)
  )
);

CREATE FUNCTION catalog.anchor_offer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Versions sans trou, listes sans doublon, horloge serveur, et publication
-- réservée aux partenaires dont le dossier courant est validé.
CREATE FUNCTION catalog.anchor_offer_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
  owner text;
  owner_status text;
BEGIN
  SELECT max(version) INTO latest
  FROM catalog.offer_version
  WHERE offer_id = NEW.offer_id;
  IF NEW.version <> COALESCE(latest, 0) + 1 THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: version % attendue, % reçue',
      COALESCE(latest, 0) + 1, NEW.version;
  END IF;
  IF cardinality(NEW.models) <> (SELECT count(DISTINCT m) FROM unnest(NEW.models) AS m)
     OR cardinality(NEW.city_ids) <> (SELECT count(DISTINCT c) FROM unnest(NEW.city_ids) AS c) THEN
    RAISE EXCEPTION 'CATALOG_OFFER_INCOMPLETE: modèle ou ville dupliqué';
  END IF;
  IF NEW.state = 'PUBLISHED' THEN
    SELECT o.partner_id, s.status INTO owner, owner_status
    FROM catalog.offer o
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
    WHERE o.id = NEW.offer_id;
    IF owner_status IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: partenaire % non validé', owner;
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.anchor_offer() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.anchor_offer_version() FROM PUBLIC;

CREATE TRIGGER offer_anchor
  BEFORE INSERT ON catalog.offer
  FOR EACH ROW EXECUTE FUNCTION catalog.anchor_offer();
CREATE TRIGGER offer_version_anchor
  BEFORE INSERT ON catalog.offer_version
  FOR EACH ROW EXECUTE FUNCTION catalog.anchor_offer_version();
CREATE TRIGGER offer_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.offer
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER offer_no_truncate
  BEFORE TRUNCATE ON catalog.offer
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER offer_version_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.offer_version
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER offer_version_no_truncate
  BEFORE TRUNCATE ON catalog.offer_version
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();

ALTER TABLE catalog.offer ENABLE ALWAYS TRIGGER offer_anchor;
ALTER TABLE catalog.offer ENABLE ALWAYS TRIGGER offer_no_update_delete;
ALTER TABLE catalog.offer ENABLE ALWAYS TRIGGER offer_no_truncate;
ALTER TABLE catalog.offer_version ENABLE ALWAYS TRIGGER offer_version_anchor;
ALTER TABLE catalog.offer_version ENABLE ALWAYS TRIGGER offer_version_no_update_delete;
ALTER TABLE catalog.offer_version ENABLE ALWAYS TRIGGER offer_version_no_truncate;

-- Version courante de chaque offre et statut dérivé de son partenaire.
-- Le prix est exposé en texte : aucun passage par un flottant côté client.
CREATE VIEW catalog.offer_current
WITH (security_invoker = true) AS
SELECT
  v.offer_id,
  v.version,
  o.partner_id,
  COALESCE(s.status, 'PENDING') AS partner_status,
  v.universe,
  v.models,
  v.city_ids,
  v.price_xaf::text AS price_xaf,
  v.availability_kind,
  v.stock_units,
  v.lead_days,
  v.warranty,
  v.discount_terms,
  v.state,
  v.created_at
FROM catalog.offer_version v
JOIN catalog.offer o ON o.id = v.offer_id
LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
WHERE v.version = (
  SELECT max(x.version) FROM catalog.offer_version x
  WHERE x.offer_id = v.offer_id
);

GRANT SELECT, INSERT ON catalog.offer, catalog.offer_version TO app_rw;
GRANT SELECT ON catalog.offer, catalog.offer_version TO app_ro;
GRANT SELECT ON catalog.offer_current TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON catalog.offer, catalog.offer_version FROM app_rw, app_ro;

COMMIT;
