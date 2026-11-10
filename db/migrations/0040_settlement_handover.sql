-- Migration 0040 — codes de remise et remises (lot 12 : F-SAV-004, F-SET-001,
-- CDC_04 § 2.2, D45). Dépend de 0001, 0003, 0011, 0038, 0039.
--
-- Code de remise : émis quand l'accord A est FUNDED ; seule son empreinte
-- HMAC-SHA256 poivrée est conservée ; validité lue dans le paramètre versionné
-- « handover_code_validity_days » (1 à 90, fermé par défaut) ; un seul code
-- valide à la fois.
-- Remise : le marchand de l'accord saisit le code, avec géolocalisation ;
-- dans la même transaction (I-6) : écriture HANDOVER débit 2100 du client /
-- crédit 2200 du marchand (prix figé), remise, et FUNDED → HANDED_OVER.
-- La base refuse chacune sans les deux autres.

BEGIN;

CREATE SCHEMA IF NOT EXISTS settlement;
REVOKE ALL ON SCHEMA settlement FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE settlement.handover_code (
  agreement_id uuid NOT NULL REFERENCES agreements.agreement (id),
  seq integer NOT NULL CHECK (seq >= 1),
  code_mac bytea NOT NULL UNIQUE CHECK (octet_length(code_mac) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (agreement_id, seq),
  CONSTRAINT handover_code_expiry_after_issue CHECK (expires_at > issued_at)
);

CREATE TABLE settlement.handover (
  agreement_id uuid PRIMARY KEY REFERENCES agreements.agreement (id),
  code_seq integer NOT NULL,
  partner_id text NOT NULL CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  partner_user_id text NOT NULL CHECK (
    length(partner_user_id) BETWEEN 1 AND 200 AND partner_user_id !~ '[[:space:]]'
  ),
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  entry_id uuid NOT NULL UNIQUE REFERENCES ledger.journal_entry (id),
  used_at timestamptz NOT NULL,
  FOREIGN KEY (agreement_id, code_seq) REFERENCES settlement.handover_code (agreement_id, seq)
);

CREATE FUNCTION settlement.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SETTLEMENT_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE FUNCTION settlement.anchor_handover_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  agreement_model text;
  agreement_status text;
  validity jsonb;
  days integer;
BEGIN
  SELECT s.model, s.status INTO agreement_model, agreement_status
  FROM agreements.agreement_state s WHERE s.id = NEW.agreement_id;
  IF agreement_model IS DISTINCT FROM 'SAVE_THEN_BUY'
     OR agreement_status IS DISTINCT FROM 'FUNDED' THEN
    RAISE EXCEPTION 'HANDOVER_NOT_ALLOWED: accord % à l’état %', NEW.agreement_id, agreement_status;
  END IF;
  SELECT s.value INTO validity
  FROM admin.setting_version s
  WHERE s.key = 'handover_code_validity_days'
  ORDER BY s.version DESC LIMIT 1;
  IF validity IS NULL OR jsonb_typeof(validity) <> 'number'
     OR validity::text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'HANDOVER_SETTINGS_NOT_CONFIGURED: durée de validité non publiée';
  END IF;
  days := validity::text::integer;
  IF days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'HANDOVER_SETTINGS_NOT_CONFIGURED: durée % hors 1–90 jours', days;
  END IF;
  IF EXISTS (
    SELECT 1 FROM settlement.handover_code c
    WHERE c.agreement_id = NEW.agreement_id AND c.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'HANDOVER_CODE_ACTIVE: un code valide existe déjà';
  END IF;
  SELECT COALESCE(max(c.seq), 0) + 1 INTO NEW.seq
  FROM settlement.handover_code c WHERE c.agreement_id = NEW.agreement_id;
  NEW.issued_at := clock_timestamp();
  NEW.expires_at := NEW.issued_at + make_interval(days => days);
  RETURN NEW;
END $$;

CREATE FUNCTION settlement.anchor_handover() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  code_expires timestamptz;
  latest_seq integer;
  agreement_partner text;
  agreement_customer uuid;
  agreement_target bigint;
  agreement_status text;
  partner_owner uuid;
  entry_type text;
  entry_agreement text;
  line_count integer;
  client_debit bigint;
  partner_credit bigint;
BEGIN
  SELECT c.expires_at INTO code_expires
  FROM settlement.handover_code c
  WHERE c.agreement_id = NEW.agreement_id AND c.seq = NEW.code_seq;
  SELECT max(c.seq) INTO latest_seq
  FROM settlement.handover_code c WHERE c.agreement_id = NEW.agreement_id;
  IF code_expires IS NULL OR NEW.code_seq <> latest_seq THEN
    RAISE EXCEPTION 'HANDOVER_CODE_INVALID: code inconnu ou remplacé';
  END IF;
  IF code_expires <= clock_timestamp() THEN
    RAISE EXCEPTION 'HANDOVER_CODE_EXPIRED: code expiré';
  END IF;
  SELECT a.partner_id, a.customer_id, a.target_xaf, s.status
    INTO agreement_partner, agreement_customer, agreement_target, agreement_status
  FROM agreements.agreement a
  JOIN agreements.agreement_state s ON s.id = a.id
  WHERE a.id = NEW.agreement_id;
  IF agreement_partner IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'HANDOVER_CODE_INVALID: code inconnu ou remplacé';
  END IF;
  IF agreement_status IS DISTINCT FROM 'FUNDED' THEN
    RAISE EXCEPTION 'HANDOVER_NOT_ALLOWED: accord à l’état %', agreement_status;
  END IF;
  SELECT i.owner_id INTO partner_owner
  FROM catalog.partner_ledger_identity i WHERE i.partner_id = NEW.partner_id;

  SELECT e.operation_type, e.business_refs ->> 'agreement_id'
    INTO entry_type, entry_agreement
  FROM ledger.journal_entry e WHERE e.id = NEW.entry_id;
  SELECT
    count(*),
    COALESCE(sum(p.amount_xaf) FILTER (
      WHERE p.direction = 'D' AND acc.code = '2100' AND acc.owner_type = 'CLIENT'
        AND acc.owner_id = agreement_customer), 0),
    COALESCE(sum(p.amount_xaf) FILTER (
      WHERE p.direction = 'C' AND acc.code = '2200' AND acc.owner_type = 'PARTNER'
        AND acc.owner_id = partner_owner), 0)
    INTO line_count, client_debit, partner_credit
  FROM ledger.posting p JOIN ledger.account acc ON acc.id = p.account_id
  WHERE p.entry_id = NEW.entry_id;
  IF entry_type IS DISTINCT FROM 'HANDOVER'
     OR entry_agreement IS DISTINCT FROM NEW.agreement_id::text
     OR partner_owner IS NULL
     OR line_count <> 2
     OR client_debit <> agreement_target
     OR partner_credit <> agreement_target THEN
    RAISE EXCEPTION 'HANDOVER_INCOMPLETE: écriture de remise non conforme';
  END IF;
  NEW.used_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Pas de remise sans état : à la validation, l'accord est passé FUNDED → HANDED_OVER.
CREATE FUNCTION settlement.assert_handover_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_from text;
  last_to text;
BEGIN
  SELECT e.from_status, e.to_status INTO last_from, last_to
  FROM agreements.status_event e
  WHERE e.agreement_id = NEW.agreement_id AND e.kind = 'TRANSITION'
  ORDER BY e.seq DESC LIMIT 1;
  IF last_from IS DISTINCT FROM 'FUNDED' OR last_to IS DISTINCT FROM 'HANDED_OVER' THEN
    RAISE EXCEPTION 'HANDOVER_INCOMPLETE: l’accord n’est pas passé à HANDED_OVER';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION settlement.forbid_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_handover_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_handover() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.assert_handover_transition() FROM PUBLIC;

CREATE TRIGGER handover_code_anchor BEFORE INSERT ON settlement.handover_code
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_handover_code();
CREATE TRIGGER handover_anchor BEFORE INSERT ON settlement.handover
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_handover();
CREATE CONSTRAINT TRIGGER handover_transition AFTER INSERT ON settlement.handover
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION settlement.assert_handover_transition();
CREATE TRIGGER handover_code_no_update_delete BEFORE UPDATE OR DELETE ON settlement.handover_code
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER handover_code_no_truncate BEFORE TRUNCATE ON settlement.handover_code
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER handover_no_update_delete BEFORE UPDATE OR DELETE ON settlement.handover
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER handover_no_truncate BEFORE TRUNCATE ON settlement.handover
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();

ALTER TABLE settlement.handover_code ENABLE ALWAYS TRIGGER handover_code_anchor;
ALTER TABLE settlement.handover_code ENABLE ALWAYS TRIGGER handover_code_no_update_delete;
ALTER TABLE settlement.handover_code ENABLE ALWAYS TRIGGER handover_code_no_truncate;
ALTER TABLE settlement.handover ENABLE ALWAYS TRIGGER handover_anchor;
ALTER TABLE settlement.handover ENABLE ALWAYS TRIGGER handover_transition;
ALTER TABLE settlement.handover ENABLE ALWAYS TRIGGER handover_no_update_delete;
ALTER TABLE settlement.handover ENABLE ALWAYS TRIGGER handover_no_truncate;

GRANT USAGE ON SCHEMA settlement TO app_rw, app_ro;
GRANT SELECT, INSERT ON settlement.handover_code, settlement.handover TO app_rw;
GRANT SELECT ON settlement.handover_code, settlement.handover TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON settlement.handover_code, settlement.handover FROM app_rw, app_ro;

COMMIT;
