-- Migration 0014 — registre des incidents partenaires (F-SAV-006).
-- Dépend de 0008, 0009, 0011, 0013.
-- Une défaillance marchand est tracée au registre (ajout seul) et a un effet
-- uniquement restrictif : plus de publication d'offre, plus de nouvel accord,
-- offres retirées du catalogue public. Aucune levée n'est prévue (D31) : lever
-- un blocage serait l'opération sensible et exige une décision du fondateur.
-- Les remèdes client (article équivalent ou remboursement intégral) passent
-- par le grand livre et le règlement (lot 12).

BEGIN;

CREATE TABLE catalog.partner_incident (
  id uuid PRIMARY KEY,
  partner_id text NOT NULL
    CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  kind text NOT NULL CHECK (kind IN ('MERCHANT_DEFAULT')),
  reason text NOT NULL
    CHECK (length(btrim(reason)) >= 1 AND length(reason) <= 500),
  reported_by text NOT NULL CHECK (
    length(reported_by) BETWEEN 1 AND 200 AND reported_by !~ '[[:space:]]'
  ),
  created_at timestamptz NOT NULL,
  CONSTRAINT partner_incident_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT partner_incident_one_default UNIQUE (partner_id, kind)
);

CREATE FUNCTION catalog.anchor_partner_incident() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type text;
BEGIN
  SELECT partner_type INTO owner_type
  FROM catalog.partner_state WHERE partner_id = NEW.partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: partenaire % inconnu', NEW.partner_id;
  END IF;
  IF NEW.kind = 'MERCHANT_DEFAULT' AND owner_type IS DISTINCT FROM 'MERCHANT' THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: % n''est pas un marchand', NEW.partner_id;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.anchor_partner_incident() FROM PUBLIC;

CREATE TRIGGER partner_incident_anchor
  BEFORE INSERT ON catalog.partner_incident
  FOR EACH ROW EXECUTE FUNCTION catalog.anchor_partner_incident();
CREATE TRIGGER partner_incident_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.partner_incident
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER partner_incident_no_truncate
  BEFORE TRUNCATE ON catalog.partner_incident
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();

ALTER TABLE catalog.partner_incident ENABLE ALWAYS TRIGGER partner_incident_anchor;
ALTER TABLE catalog.partner_incident ENABLE ALWAYS TRIGGER partner_incident_no_update_delete;
ALTER TABLE catalog.partner_incident ENABLE ALWAYS TRIGGER partner_incident_no_truncate;

-- Colonnes ajoutées en fin de vue (CREATE OR REPLACE n'autorise que l'ajout).
CREATE OR REPLACE VIEW catalog.partner_state
WITH (security_invoker = true) AS
SELECT
  d.partner_id,
  d.version AS dossier_version,
  CASE WHEN v.partner_id IS NULL THEN 'PENDING' ELSE 'VALIDATED' END AS status,
  v.approval_request_id,
  v.validated_at,
  d.partner_type,
  d.beneficiary_kind,
  EXISTS (
    SELECT 1 FROM catalog.partner_incident i
    WHERE i.partner_id = d.partner_id AND i.kind = 'MERCHANT_DEFAULT'
  ) AS in_default
FROM catalog.partner_dossier d
LEFT JOIN catalog.partner_validation v
  ON v.partner_id = d.partner_id AND v.dossier_version = d.version
WHERE d.version = (
  SELECT max(x.version) FROM catalog.partner_dossier x
  WHERE x.partner_id = d.partner_id
);

CREATE OR REPLACE VIEW catalog.offer_current
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
  v.created_at,
  COALESCE(s.in_default, false) AS partner_in_default
FROM catalog.offer_version v
JOIN catalog.offer o ON o.id = v.offer_id
LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
WHERE v.version = (
  SELECT max(x.version) FROM catalog.offer_version x
  WHERE x.offer_id = v.offer_id
);

-- Reprise de 0013 : refus de publication pour un marchand défaillant.
CREATE OR REPLACE FUNCTION catalog.anchor_offer_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest integer;
  owner text;
  owner_status text;
  owner_type text;
  owner_in_default boolean;
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
    SELECT o.partner_id, s.status, s.partner_type, s.in_default
      INTO owner, owner_status, owner_type, owner_in_default
    FROM catalog.offer o
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
    WHERE o.id = NEW.offer_id;
    IF owner_status IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: partenaire % non validé', owner;
    END IF;
    IF owner_type IS DISTINCT FROM 'MERCHANT' THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_NOT_VALIDATED: % n''est pas un marchand', owner;
    END IF;
    IF owner_in_default THEN
      RAISE EXCEPTION 'CATALOG_PARTNER_IN_DEFAULT: marchand % défaillant', owner;
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Reprise de 0013 : un marchand défaillant n'ouvre plus d'accord A.
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
BEGIN
  IF NEW.model = 'SAVE_THEN_BUY' THEN
    SELECT max(version) INTO current_version
    FROM catalog.offer_version
    WHERE offer_id = NEW.offer_id;
    IF current_version IS DISTINCT FROM NEW.offer_version THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: version % non courante', NEW.offer_version;
    END IF;
    SELECT v.price_xaf, v.state, v.models, o.partner_id, s.status, s.in_default
      INTO version_price, version_state, version_models, owner, owner_status, owner_in_default
    FROM catalog.offer_version v
    JOIN catalog.offer o ON o.id = v.offer_id
    LEFT JOIN catalog.partner_state s ON s.partner_id = o.partner_id
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
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Reprise de 0011 : un brouillon d'un marchand devenu défaillant ne s'active plus.
CREATE OR REPLACE FUNCTION agreements.assert_status_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  latest_seq integer;
  current_status text;
  is_locked boolean;
  dispute_origin text;
  scope text;
  partner_defaulted boolean;
BEGIN
  -- Pas de verrou de ligne (app_rw n'a pas UPDATE) : deux ajouts concurrents
  -- calculent la même séquence et la clé primaire n'en accepte qu'un.
  SELECT model INTO agreement_model
  FROM agreements.agreement WHERE id = NEW.agreement_id;
  SELECT max(seq) INTO latest_seq
  FROM agreements.status_event WHERE agreement_id = NEW.agreement_id;
  IF NEW.seq <> COALESCE(latest_seq, 0) + 1 THEN
    RAISE EXCEPTION 'AGREEMENT_INVALID_REQUEST: séquence % attendue, % reçue',
      COALESCE(latest_seq, 0) + 1, NEW.seq;
  END IF;
  SELECT e.to_status INTO current_status
  FROM agreements.status_event e
  WHERE e.agreement_id = NEW.agreement_id AND e.seq = latest_seq;
  current_status := COALESCE(current_status, 'DRAFT');
  IF NEW.from_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: état courant %, reçu %',
      current_status, NEW.from_status;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM agreements.status_event
    WHERE agreement_id = NEW.agreement_id AND kind = 'LOCK'
  ) INTO is_locked;

  IF NEW.kind = 'LOCK' THEN
    IF is_locked THEN
      RAISE EXCEPTION 'AGREEMENT_LOCKED: objectif déjà verrouillé';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;

  scope := CASE NEW.from_status || '>' || NEW.to_status
    WHEN 'DRAFT>ACTIVE' THEN 'ANY'
    WHEN 'ACTIVE>FUNDED' THEN 'ANY'
    WHEN 'FUNDED>HANDED_OVER' THEN 'SAVE_THEN_BUY'
    WHEN 'FUNDED>PAID_TO_BENEFICIARY' THEN 'PLANNED_EXPENSE'
    WHEN 'HANDED_OVER>CLOSED' THEN 'SAVE_THEN_BUY'
    WHEN 'PAID_TO_BENEFICIARY>CLOSED' THEN 'PLANNED_EXPENSE'
    WHEN 'ACTIVE>CANCELLED_BY_CUSTOMER' THEN 'ANY'
    WHEN 'CANCELLED_BY_CUSTOMER>REFUNDED' THEN 'ANY'
    WHEN 'REFUNDED>CLOSED' THEN 'ANY'
    WHEN 'ACTIVE>DISPUTED' THEN 'ANY'
    WHEN 'FUNDED>DISPUTED' THEN 'ANY'
    WHEN 'DISPUTED>ACTIVE' THEN 'ANY'
    WHEN 'DISPUTED>FUNDED' THEN 'ANY'
    WHEN 'DISPUTED>REFUNDED' THEN 'ANY'
    WHEN 'ACTIVE>FROZEN' THEN 'ANY'
    WHEN 'FROZEN>ACTIVE' THEN 'ANY'
    WHEN 'FROZEN>REFUNDED' THEN 'ANY'
    ELSE NULL
  END;
  IF scope IS NULL OR (scope <> 'ANY' AND scope <> agreement_model) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: % → % interdite',
      NEW.from_status, NEW.to_status;
  END IF;
  IF NEW.from_status = 'DRAFT' AND NEW.to_status = 'ACTIVE' THEN
    SELECT COALESCE(s.in_default, false) INTO partner_defaulted
    FROM agreements.agreement a
    LEFT JOIN catalog.partner_state s ON s.partner_id = a.partner_id
    WHERE a.id = NEW.agreement_id;
    IF partner_defaulted THEN
      RAISE EXCEPTION 'AGREEMENT_OFFER_NOT_AVAILABLE: marchand défaillant, activation refusée';
    END IF;
  END IF;
  IF NEW.to_status = 'CANCELLED_BY_CUSTOMER' AND is_locked THEN
    RAISE EXCEPTION 'AGREEMENT_LOCKED: objectif verrouillé, annulation refusée';
  END IF;
  IF NEW.from_status = 'DISPUTED' AND NEW.to_status <> 'REFUNDED' THEN
    SELECT e.from_status INTO dispute_origin
    FROM agreements.status_event e
    WHERE e.agreement_id = NEW.agreement_id
      AND e.kind = 'TRANSITION' AND e.to_status = 'DISPUTED'
    ORDER BY e.seq DESC LIMIT 1;
    IF dispute_origin IS DISTINCT FROM NEW.to_status THEN
      RAISE EXCEPTION 'UNAUTHORIZED_TRANSITION: un litige ne revient qu’à %', dispute_origin;
    END IF;
  END IF;
  IF NEW.to_status IN ('FUNDED', 'HANDED_OVER', 'PAID_TO_BENEFICIARY', 'REFUNDED') THEN
    RAISE EXCEPTION 'AGREEMENT_LEDGER_LINK_REQUIRED: % exige une écriture du grand livre',
      NEW.to_status;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION catalog.anchor_offer_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.anchor_agreement() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.assert_status_event() FROM PUBLIC;

GRANT SELECT, INSERT ON catalog.partner_incident TO app_rw;
GRANT SELECT ON catalog.partner_incident TO app_ro;
GRANT SELECT ON catalog.partner_state, catalog.offer_current TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON catalog.partner_incident FROM app_rw, app_ro;

COMMIT;
