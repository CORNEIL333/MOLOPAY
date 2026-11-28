-- Migration 0013 — type de partenaire et bénéficiaires vérifiés
-- (CDC_05 § 4 Partner.type, F-PLN-001, SEC-AUTHZ-003).
-- Dépend de 0008, 0009 et 0011.
-- Le type et la catégorie de bénéficiaire font partie du dossier, donc de son
-- empreinte : l'approbation maker-checker les couvre. Les dossiers antérieurs
-- (aucun en production) sont marqués MERCHANT ; leur empreinte, calculée sans
-- ces champs, ne se revérifie plus et ils doivent être revalidés.
-- La base réserve la publication d'offres aux marchands et refuse un objectif C
-- dont le bénéficiaire n'est pas un partenaire BENEFICIARY validé.

BEGIN;

ALTER TABLE catalog.partner_dossier
  ADD COLUMN partner_type text NOT NULL DEFAULT 'MERCHANT'
    CHECK (partner_type IN ('MERCHANT', 'BENEFICIARY')),
  ADD COLUMN beneficiary_kind text
    CHECK (beneficiary_kind IS NULL OR beneficiary_kind IN (
      'LANDLORD', 'AGENCY', 'SCHOOL', 'MATERIALS_SELLER', 'LAND_SELLER'
    )),
  ADD CONSTRAINT partner_dossier_kind_matches_type CHECK (
    (partner_type = 'MERCHANT' AND beneficiary_kind IS NULL)
    OR (partner_type = 'BENEFICIARY' AND beneficiary_kind IS NOT NULL)
  );

-- Plus de valeur implicite : tout nouveau dossier déclare son type.
ALTER TABLE catalog.partner_dossier ALTER COLUMN partner_type DROP DEFAULT;

CREATE OR REPLACE VIEW catalog.partner_state
WITH (security_invoker = true) AS
SELECT
  d.partner_id,
  d.version AS dossier_version,
  CASE WHEN v.partner_id IS NULL THEN 'PENDING' ELSE 'VALIDATED' END AS status,
  v.approval_request_id,
  v.validated_at,
  d.partner_type,
  d.beneficiary_kind
FROM catalog.partner_dossier d
LEFT JOIN catalog.partner_validation v
  ON v.partner_id = d.partner_id AND v.dossier_version = d.version
WHERE d.version = (
  SELECT max(x.version) FROM catalog.partner_dossier x
  WHERE x.partner_id = d.partner_id
);

-- Reprise de 0009 : seule la condition sur le type est ajoutée.
CREATE OR REPLACE FUNCTION catalog.anchor_offer_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
  owner text;
  owner_status text;
  owner_type text;
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
    SELECT o.partner_id, s.status, s.partner_type INTO owner, owner_status, owner_type
    FROM catalog.offer o
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
    WHERE o.id = NEW.offer_id;
    IF owner_status IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: partenaire % non validé', owner;
    END IF;
    IF owner_type IS DISTINCT FROM 'MERCHANT' THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: % n''est pas un marchand', owner;
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Reprise de 0011 : la branche C vérifie désormais le bénéficiaire en base.
CREATE OR REPLACE FUNCTION agreements.anchor_agreement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_version integer;
  version_price bigint;
  version_state text;
  version_models text[];
  owner text;
  owner_status text;
  beneficiary_status text;
  beneficiary_type text;
BEGIN
  IF NEW.model = 'SAVE_THEN_BUY' THEN
    SELECT max(version) INTO current_version
    FROM catalog.offer_version
    WHERE offer_id = NEW.offer_id;
    IF current_version IS DISTINCT FROM NEW.offer_version THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: version % non courante', NEW.offer_version;
    END IF;
    SELECT v.price_xaf, v.state, v.models, o.partner_id, s.status
      INTO version_price, version_state, version_models, owner, owner_status
    FROM catalog.offer_version v
    JOIN catalog.offer o ON o.id = v.offer_id
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
    WHERE v.offer_id = NEW.offer_id AND v.version = NEW.offer_version;
    IF version_state IS DISTINCT FROM 'PUBLISHED'
       OR owner_status IS DISTINCT FROM 'VALIDATED'
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
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.anchor_offer_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.anchor_agreement() FROM PUBLIC;
GRANT SELECT ON catalog.partner_state TO app_rw, app_ro;

COMMIT;
