-- Migration 0011 — accords A et C (F-SAV-001/003/005, F-PLN-001, F-CAT-003).
-- Dépend de 0008 et 0009 (catalog.partner_state, catalog.offer_version).
-- L'accord est immuable : ses conditions ne changent jamais (CDC_05 § 4).
-- Pour A, la base impose que la cible égale le prix de la version COURANTE
-- et publiée de l'offre (I-11) : un client ne peut viser une version ancienne.
-- Les statuts sont un journal d'événements en ajout seul ; la base n'accepte
-- que les transitions de CDC_05 § 5.2. Les transitions qui supposent un
-- mouvement de fonds (FUNDED, HANDED_OVER, PAID_TO_BENEFICIARY, REFUNDED)
-- sont refusées tant que le lien vers l'écriture du grand livre n'existe pas
-- (I-6, lots 11 et 12).

BEGIN;

CREATE SCHEMA IF NOT EXISTS agreements;
REVOKE ALL ON SCHEMA agreements FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE agreements.agreement (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  model text NOT NULL CHECK (model IN ('SAVE_THEN_BUY', 'PLANNED_EXPENSE')),
  offer_id uuid,
  offer_version integer,
  partner_id text
    CHECK (partner_id IS NULL OR partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  beneficiary_id text
    CHECK (beneficiary_id IS NULL OR beneficiary_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  target_xaf bigint NOT NULL CHECK (target_xaf > 0),
  plan_id text NOT NULL CHECK (plan_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  rhythm text NOT NULL CHECK (rhythm IN ('DAILY', 'WEEKLY', 'MONTHLY', 'FREE')),
  min_amount_xaf bigint NOT NULL CHECK (min_amount_xaf > 0),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
  refund_policy text NOT NULL CHECK (refund_policy IN ('FULL_NO_FEE')),
  terms_hash bytea NOT NULL CHECK (octet_length(terms_hash) = 32),
  created_at timestamptz NOT NULL,
  CONSTRAINT agreement_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT agreement_min_le_target CHECK (min_amount_xaf <= target_xaf),
  CONSTRAINT agreement_model_target CHECK (
    (model = 'SAVE_THEN_BUY'
      AND offer_id IS NOT NULL AND offer_version IS NOT NULL
      AND partner_id IS NOT NULL AND beneficiary_id IS NULL)
    OR (model = 'PLANNED_EXPENSE'
      AND offer_id IS NULL AND offer_version IS NULL
      AND partner_id IS NULL AND beneficiary_id IS NOT NULL)
  ),
  CONSTRAINT agreement_offer_version_fk
    FOREIGN KEY (offer_id, offer_version)
    REFERENCES catalog.offer_version (offer_id, version)
);

CREATE INDEX agreement_customer_idx ON agreements.agreement (customer_id);

CREATE TABLE agreements.status_event (
  agreement_id uuid NOT NULL REFERENCES agreements.agreement (id),
  seq integer NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (kind IN ('TRANSITION', 'LOCK')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  device_id uuid,
  signature bytea CHECK (signature IS NULL OR octet_length(signature) BETWEEN 1 AND 512),
  actor_id text NOT NULL CHECK (
    length(actor_id) BETWEEN 1 AND 200 AND actor_id !~ '[[:space:]]'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (agreement_id, seq),
  CONSTRAINT status_event_lock_keeps_status CHECK (
    kind <> 'LOCK' OR (from_status = 'ACTIVE' AND to_status = 'ACTIVE')
  ),
  -- CDC_05 § 4 : un accord est signé par l'appareil du client à l'activation.
  CONSTRAINT status_event_activation_signed CHECK (
    (kind = 'TRANSITION' AND from_status = 'DRAFT' AND to_status = 'ACTIVE'
      AND device_id IS NOT NULL AND signature IS NOT NULL)
    OR (NOT (kind = 'TRANSITION' AND from_status = 'DRAFT' AND to_status = 'ACTIVE')
      AND device_id IS NULL AND signature IS NULL)
  )
);

CREATE FUNCTION agreements.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AGREEMENT_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- I-11 : pour A, version courante, publiée, partenaire validé, cible = prix.
CREATE FUNCTION agreements.anchor_agreement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_version integer;
  version_price bigint;
  version_state text;
  version_models text[];
  owner text;
  owner_status text;
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
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Transitions CDC_05 § 5.2 en liste blanche, état courant dérivé du journal.
CREATE FUNCTION agreements.assert_status_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  latest_seq integer;
  current_status text;
  is_locked boolean;
  dispute_origin text;
  scope text;
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

REVOKE ALL ON FUNCTION agreements.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.anchor_agreement() FROM PUBLIC;
REVOKE ALL ON FUNCTION agreements.assert_status_event() FROM PUBLIC;

CREATE TRIGGER agreement_anchor
  BEFORE INSERT ON agreements.agreement
  FOR EACH ROW EXECUTE FUNCTION agreements.anchor_agreement();
CREATE TRIGGER status_event_assert
  BEFORE INSERT ON agreements.status_event
  FOR EACH ROW EXECUTE FUNCTION agreements.assert_status_event();
CREATE TRIGGER agreement_no_update_delete
  BEFORE UPDATE OR DELETE ON agreements.agreement
  FOR EACH ROW EXECUTE FUNCTION agreements.forbid_mutation();
CREATE TRIGGER agreement_no_truncate
  BEFORE TRUNCATE ON agreements.agreement
  FOR EACH STATEMENT EXECUTE FUNCTION agreements.forbid_mutation();
CREATE TRIGGER status_event_no_update_delete
  BEFORE UPDATE OR DELETE ON agreements.status_event
  FOR EACH ROW EXECUTE FUNCTION agreements.forbid_mutation();
CREATE TRIGGER status_event_no_truncate
  BEFORE TRUNCATE ON agreements.status_event
  FOR EACH STATEMENT EXECUTE FUNCTION agreements.forbid_mutation();

ALTER TABLE agreements.agreement ENABLE ALWAYS TRIGGER agreement_anchor;
ALTER TABLE agreements.agreement ENABLE ALWAYS TRIGGER agreement_no_update_delete;
ALTER TABLE agreements.agreement ENABLE ALWAYS TRIGGER agreement_no_truncate;
ALTER TABLE agreements.status_event ENABLE ALWAYS TRIGGER status_event_assert;
ALTER TABLE agreements.status_event ENABLE ALWAYS TRIGGER status_event_no_update_delete;
ALTER TABLE agreements.status_event ENABLE ALWAYS TRIGGER status_event_no_truncate;

-- État courant dérivé du journal ; montants exposés en texte.
CREATE VIEW agreements.agreement_state
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
  ) AS locked
FROM agreements.agreement a;

GRANT USAGE ON SCHEMA agreements TO app_rw, app_ro;
GRANT SELECT, INSERT ON agreements.agreement, agreements.status_event TO app_rw;
GRANT SELECT ON agreements.agreement, agreements.status_event TO app_ro;
GRANT SELECT ON agreements.agreement_state TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON agreements.agreement, agreements.status_event
  FROM app_rw, app_ro;

COMMIT;
