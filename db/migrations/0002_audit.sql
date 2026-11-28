-- Migration 0002 — journal d'audit de sécurité chaîné, en ajout seul.
-- Exigences : SEC-LOG-001, F-BO-004, INT-HASH-005, I-3.
-- La base garantit la continuité (séquence, prev_hash), l'ajout seul et le
-- motif des lectures sensibles ; elle ne peut pas recalculer event_hash sans
-- canonicalisation JCS : l'intégrité du contenu est vérifiée par
-- verifyAuditChain (application) et par le test de bout en bout.
-- Les migrations sont additives ; toute correction de schéma passe par une
-- nouvelle migration.

BEGIN;

CREATE SCHEMA IF NOT EXISTS audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE audit.event (
  seq bigint PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'AUTH_LOGIN',
    'AUTH_LOGIN_FAILED',
    'AUTH_LOGOUT',
    'PERMISSION_CHANGED',
    'SENSITIVE_DATA_READ',
    'FINANCIAL_HISTORY_READ',
    'BACKOFFICE_ACTION',
    'CONFIG_CHANGED',
    'EXPORT_CREATED'
  )),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  target_type text NOT NULL CHECK (length(btrim(target_type)) > 0),
  target_id text NOT NULL CHECK (length(btrim(target_id)) > 0),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'ERROR')),
  reason text NULL CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  refs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(refs) = 'object'),
  prev_hash bytea NOT NULL,
  event_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_seq_positive CHECK (seq >= 1),
  CONSTRAINT event_hashes_length CHECK (
    octet_length(prev_hash) = 32 AND octet_length(event_hash) = 32
  ),
  CONSTRAINT event_sensitive_reason_required CHECK (
    event_type NOT IN ('SENSITIVE_DATA_READ', 'FINANCIAL_HISTORY_READ')
    OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

CREATE INDEX audit_event_recorded_at_idx ON audit.event (recorded_at DESC, seq DESC);
CREATE INDEX audit_event_actor_idx ON audit.event (actor_id, seq DESC);
CREATE INDEX audit_event_target_idx ON audit.event (target_type, target_id, seq DESC);
CREATE INDEX audit_event_type_idx ON audit.event (event_type, seq DESC);

-- Verrou de chaîne à prendre avant le calcul du numéro et du prev_hash.
CREATE FUNCTION audit.lock_chain() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('audit.chain', 0));
$$;

REVOKE ALL ON FUNCTION audit.lock_chain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.lock_chain() TO app_rw;

-- Chaîne de hachage : séquence sans trou depuis 1, prev_hash = hash précédent.
CREATE FUNCTION audit.assert_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash bytea;
  zero_hash bytea := decode(repeat('00', 32), 'hex');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit.chain', 0));

  SELECT seq, event_hash INTO last_seq, last_hash
  FROM audit.event
  ORDER BY seq DESC
  LIMIT 1;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 THEN
      RAISE EXCEPTION 'AUDIT_SEQUENCE_GAP: première séquence attendue 1 reçue %', NEW.seq;
    END IF;
    IF NEW.prev_hash <> zero_hash THEN
      RAISE EXCEPTION 'AUDIT_CHAIN_BROKEN: prev_hash du premier événement doit être nul';
    END IF;
  ELSE
    IF NEW.seq <> last_seq + 1 THEN
      RAISE EXCEPTION 'AUDIT_SEQUENCE_GAP: séquence attendue % reçue %', last_seq + 1, NEW.seq;
    END IF;
    IF NEW.prev_hash <> last_hash THEN
      RAISE EXCEPTION 'AUDIT_CHAIN_BROKEN: prev_hash ne correspond pas à l’événement %', last_seq;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION audit.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

-- Deuxième barrière contre les secrets dans refs, même en SQL direct.
-- La liste reprend la normalisation du domaine (minuscules, sans séparateurs)
-- et doit rester en miroir de apps/api/src/modules/audit/domain.ts.
CREATE FUNCTION audit.assert_safe_refs(metadata jsonb, depth integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  entry record;
  normalized text;
BEGIN
  IF depth > 8 THEN
    RAISE EXCEPTION 'AUDIT_INVALID_EVENT: métadonnées trop profondes';
  END IF;
  IF jsonb_typeof(metadata) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
      normalized := regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g');
      IF normalized IN (
        'password', 'passwordhash', 'passwd', 'pin', 'pinnumber',
        'otp', 'otpcode', 'token', 'accesstoken', 'refreshtoken',
        'secret', 'clientsecret', 'authorization', 'cookie', 'cvv', 'cvv2',
        'pan', 'cardnumber', 'iban', 'accountnumber', 'documentnumber',
        'idnumber', 'nationalid', 'msisdn'
      ) THEN
        RAISE EXCEPTION 'AUDIT_SENSITIVE_METADATA: clé % interdite', entry.key;
      END IF;
      PERFORM audit.assert_safe_refs(entry.value, depth + 1);
    END LOOP;
  ELSIF jsonb_typeof(metadata) = 'array' THEN
    FOR entry IN SELECT item FROM jsonb_array_elements(metadata) AS item LOOP
      PERFORM audit.assert_safe_refs(entry.item, depth + 1);
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION audit.assert_safe_refs(jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.assert_safe_refs(jsonb, integer) TO app_rw;

CREATE FUNCTION audit.check_event_refs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM audit.assert_safe_refs(NEW.refs, 0);
  RETURN NEW;
END $$;

CREATE TRIGGER event_chain
  BEFORE INSERT ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.assert_chain();

CREATE TRIGGER event_refs_safe
  BEFORE INSERT ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.check_event_refs();

CREATE TRIGGER event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.forbid_mutation();
CREATE TRIGGER event_no_truncate
  BEFORE TRUNCATE ON audit.event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_mutation();

ALTER TABLE audit.event ENABLE ALWAYS TRIGGER event_chain;
ALTER TABLE audit.event ENABLE ALWAYS TRIGGER event_refs_safe;
ALTER TABLE audit.event ENABLE ALWAYS TRIGGER event_no_update_delete;
ALTER TABLE audit.event ENABLE ALWAYS TRIGGER event_no_truncate;

-- Privilèges : insertion et lecture seulement pour l'application.
GRANT USAGE ON SCHEMA audit TO app_rw, app_ro;
GRANT SELECT, INSERT ON audit.event TO app_rw;
GRANT SELECT ON audit.event TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.event FROM app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.event FROM app_ro;
REVOKE CREATE ON SCHEMA audit FROM PUBLIC;

COMMIT;
