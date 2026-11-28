-- Migration 0001 — grand livre en partie double, en ajout seul.
-- Exigences : INT-LED-001..008, INT-HASH-002/003, INT-IDEM-001, I-1, I-2, I-3, I-9.
-- Les migrations sont additives ; toute correction de schéma passe par une nouvelle migration.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ledger;
REVOKE ALL ON SCHEMA ledger FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN;
  END IF;
END $$;

CREATE TABLE ledger.account (
  id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  nature text NOT NULL CHECK (nature IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE')),
  owner_type text NULL CHECK (owner_type IN ('CLIENT', 'PARTNER', 'LENDER')),
  owner_id uuid NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_owner_pair CHECK ((owner_type IS NULL) = (owner_id IS NULL)),
  CONSTRAINT account_owner_code CHECK (
    (owner_type IS NULL AND code NOT IN ('2100', '2200', '2300'))
    OR (owner_type IS NOT NULL AND code IN ('2100', '2200', '2300'))
  ),
  CONSTRAINT account_unique_owner UNIQUE NULLS NOT DISTINCT (code, owner_type, owner_id)
);

CREATE TABLE ledger.journal_entry (
  seq bigint PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL,
  operation_type text NOT NULL CHECK (length(btrim(operation_type)) > 0),
  business_refs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(business_refs) = 'object'),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  approvers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(approvers) = 'array'),
  idem_scope text NOT NULL CHECK (length(btrim(idem_scope)) > 0),
  idem_key text NOT NULL CHECK (length(btrim(idem_key)) > 0),
  reverses_entry_id uuid NULL,
  prev_hash bytea NOT NULL,
  entry_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entry_seq_positive CHECK (seq >= 1),
  CONSTRAINT entry_hashes_length CHECK (octet_length(prev_hash) = 32 AND octet_length(entry_hash) = 32),
  CONSTRAINT entry_reversal_not_self CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id),
  CONSTRAINT entry_reversal_needs_distinct_approver CHECK (
    reverses_entry_id IS NULL
    OR (jsonb_array_length(approvers) > 0 AND NOT (approvers ? actor_id))
  ),
  CONSTRAINT entry_idempotency_unique UNIQUE (idem_scope, idem_key)
);

CREATE UNIQUE INDEX journal_entry_one_reversal_idx
  ON ledger.journal_entry (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- Une seule genèse par base : elle ancre les paramètres initiaux.
CREATE UNIQUE INDEX journal_entry_single_genesis_idx
  ON ledger.journal_entry (operation_type)
  WHERE operation_type = 'GENESIS';

ALTER TABLE ledger.journal_entry
  ADD CONSTRAINT journal_entry_reverses_fk
  FOREIGN KEY (reverses_entry_id) REFERENCES ledger.journal_entry (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ledger.posting (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES ledger.journal_entry (id),
  account_id uuid NOT NULL REFERENCES ledger.account (id),
  direction char(1) NOT NULL CHECK (direction IN ('D', 'C')),
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  ordinal smallint NOT NULL CHECK (ordinal >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_ordinal_unique UNIQUE (entry_id, ordinal),
  CONSTRAINT posting_account_unique UNIQUE (entry_id, account_id, direction)
);

CREATE INDEX posting_account_idx ON ledger.posting (account_id);
CREATE INDEX posting_entry_idx ON ledger.posting (entry_id);

-- Verrou de chaîne à prendre en première instruction de la transaction
-- d'écriture : le déclencheur seul lit un instantané pris avant l'attente et
-- provoquerait des échecs en concurrence (jamais de trou, mais des rejets).
CREATE FUNCTION ledger.lock_chain() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('ledger.chain', 0));
$$;

REVOKE ALL ON FUNCTION ledger.lock_chain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.lock_chain() TO app_rw;

-- Chaîne de hachage : séquence sans trou, prev_hash = hash de l'écriture précédente.
CREATE FUNCTION ledger.assert_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash bytea;
  zero_hash bytea := decode(repeat('00', 32), 'hex');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger.chain', 0));

  SELECT seq, entry_hash INTO last_seq, last_hash
  FROM ledger.journal_entry
  ORDER BY seq DESC
  LIMIT 1;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 THEN
      RAISE EXCEPTION 'LEDGER_SEQUENCE_GAP: première séquence attendue 1 reçue %', NEW.seq;
    END IF;
    IF NEW.operation_type <> 'GENESIS' THEN
      RAISE EXCEPTION 'LEDGER_GENESIS_REQUIRED: première écriture non GENESIS';
    END IF;
    IF NEW.prev_hash <> zero_hash THEN
      RAISE EXCEPTION 'LEDGER_GENESIS_PREV_HASH: prev_hash de genèse doit être nul';
    END IF;
    IF NOT (NEW.business_refs ? 'params_hash') THEN
      RAISE EXCEPTION 'LEDGER_GENESIS_PARAMS: params_hash absent de la genèse';
    END IF;
  ELSE
    IF NEW.seq <> last_seq + 1 THEN
      RAISE EXCEPTION 'LEDGER_SEQUENCE_GAP: séquence attendue % reçue %', last_seq + 1, NEW.seq;
    END IF;
    IF NEW.prev_hash <> last_hash THEN
      RAISE EXCEPTION 'LEDGER_CHAIN_BROKEN: prev_hash ne correspond pas à l’écriture %', last_seq;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Équilibre différé : Σ débits = Σ crédits, au moins deux lignes.
CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_entry uuid;
  debit bigint;
  credit bigint;
  line_count integer;
BEGIN
  IF TG_TABLE_NAME = 'posting' THEN
    target_entry := NEW.entry_id;
  ELSE
    target_entry := NEW.id;
  END IF;

  SELECT
    COALESCE(SUM(amount_xaf) FILTER (WHERE direction = 'D'), 0),
    COALESCE(SUM(amount_xaf) FILTER (WHERE direction = 'C'), 0),
    COUNT(*)
  INTO debit, credit, line_count
  FROM ledger.posting
  WHERE entry_id = target_entry;

  IF line_count < 2 THEN
    -- La genèse ancre les paramètres et ne déplace aucune valeur.
    IF line_count = 0 AND EXISTS (
      SELECT 1 FROM ledger.journal_entry
      WHERE id = target_entry AND operation_type = 'GENESIS'
    ) THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: écriture %', target_entry;
  END IF;
  IF debit <> credit THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: écriture % débits=% crédits=%', target_entry, debit, credit;
  END IF;

  RETURN NULL;
END $$;

-- Contre-passation : miroir exact de l'écriture d'origine, pas de re-contre-passation.
CREATE FUNCTION ledger.assert_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original_is_reversal boolean;
  original_type text;
  original_count integer;
  reversal_count integer;
  forward_missing integer;
  reverse_missing integer;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (reverses_entry_id IS NOT NULL), operation_type
  INTO original_is_reversal, original_type
  FROM ledger.journal_entry
  WHERE id = NEW.reverses_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_REVERSAL_INVALID: écriture d’origine absente';
  END IF;
  IF original_is_reversal THEN
    RAISE EXCEPTION 'LEDGER_REVERSAL_INVALID: une contre-passation ne se contre-passe pas';
  END IF;
  IF original_type = 'GENESIS' THEN
    RAISE EXCEPTION 'LEDGER_REVERSAL_INVALID: la genèse ne se contre-passe pas';
  END IF;

  SELECT COUNT(*) INTO original_count
  FROM ledger.posting WHERE entry_id = NEW.reverses_entry_id;
  SELECT COUNT(*) INTO reversal_count
  FROM ledger.posting WHERE entry_id = NEW.id;

  IF original_count <> reversal_count THEN
    RAISE EXCEPTION 'LEDGER_REVERSAL_INVALID: nombre de lignes différent';
  END IF;

  SELECT COUNT(*) INTO forward_missing FROM (
    SELECT account_id, direction, amount_xaf
    FROM ledger.posting WHERE entry_id = NEW.reverses_entry_id
    EXCEPT
    SELECT account_id, CASE direction WHEN 'D' THEN 'C' ELSE 'D' END, amount_xaf
    FROM ledger.posting WHERE entry_id = NEW.id
  ) missing_forward;

  SELECT COUNT(*) INTO reverse_missing FROM (
    SELECT account_id, CASE direction WHEN 'D' THEN 'C' ELSE 'D' END, amount_xaf
    FROM ledger.posting WHERE entry_id = NEW.id
    EXCEPT
    SELECT account_id, direction, amount_xaf
    FROM ledger.posting WHERE entry_id = NEW.reverses_entry_id
  ) missing_reverse;

  IF forward_missing <> 0 OR reverse_missing <> 0 THEN
    RAISE EXCEPTION 'LEDGER_REVERSAL_INVALID: les lignes ne sont pas le miroir exact';
  END IF;

  RETURN NEW;
END $$;

CREATE FUNCTION ledger.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER journal_entry_chain
  BEFORE INSERT ON ledger.journal_entry
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_chain();

CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT ON ledger.journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

CREATE CONSTRAINT TRIGGER journal_entry_reversal
  AFTER INSERT ON ledger.journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_reversal();

CREATE CONSTRAINT TRIGGER posting_balanced
  AFTER INSERT ON ledger.posting
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();

CREATE TRIGGER journal_entry_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger.journal_entry
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();
CREATE TRIGGER journal_entry_no_truncate
  BEFORE TRUNCATE ON ledger.journal_entry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TRIGGER posting_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger.posting
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();
CREATE TRIGGER posting_no_truncate
  BEFORE TRUNCATE ON ledger.posting
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TRIGGER account_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger.account
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();
CREATE TRIGGER account_no_truncate
  BEFORE TRUNCATE ON ledger.account
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.forbid_mutation();

ALTER TABLE ledger.journal_entry ENABLE ALWAYS TRIGGER journal_entry_chain;
ALTER TABLE ledger.journal_entry ENABLE ALWAYS TRIGGER journal_entry_balanced;
ALTER TABLE ledger.journal_entry ENABLE ALWAYS TRIGGER journal_entry_reversal;
ALTER TABLE ledger.posting ENABLE ALWAYS TRIGGER posting_balanced;
ALTER TABLE ledger.journal_entry ENABLE ALWAYS TRIGGER journal_entry_no_update_delete;
ALTER TABLE ledger.journal_entry ENABLE ALWAYS TRIGGER journal_entry_no_truncate;
ALTER TABLE ledger.posting ENABLE ALWAYS TRIGGER posting_no_update_delete;
ALTER TABLE ledger.posting ENABLE ALWAYS TRIGGER posting_no_truncate;
ALTER TABLE ledger.account ENABLE ALWAYS TRIGGER account_no_update_delete;
ALTER TABLE ledger.account ENABLE ALWAYS TRIGGER account_no_truncate;

-- Soldes dérivés des écritures, jamais stockés comme vérité (INT-LED-005).
CREATE VIEW ledger.account_balance AS
SELECT
  a.id AS account_id,
  a.code,
  a.nature,
  a.owner_type,
  a.owner_id,
  COALESCE(SUM(p.amount_xaf) FILTER (WHERE p.direction = 'D'), 0)::bigint AS debit_total_xaf,
  COALESCE(SUM(p.amount_xaf) FILTER (WHERE p.direction = 'C'), 0)::bigint AS credit_total_xaf,
  COALESCE(
    SUM(CASE WHEN p.direction = 'D' THEN p.amount_xaf ELSE -p.amount_xaf END),
    0
  )::bigint AS net_debit_xaf
FROM ledger.account a
LEFT JOIN ledger.posting p ON p.account_id = a.id
GROUP BY a.id, a.code, a.nature, a.owner_type, a.owner_id;

-- Plan de comptes minimal (CDC_04 §2.1). Les comptes 2100/2200/2300 sont
-- créés par propriétaire (owner_type/owner_id) et ne sont pas seedés ici.
INSERT INTO ledger.account (id, code, nature, owner_type, owner_id, name) VALUES
  ('019a0000-0000-7000-8000-000000001100', '1100', 'ASSET',     NULL, NULL, 'Compte cantonné chez l’établissement (miroir)'),
  ('019a0000-0000-7000-8000-000000001200', '1200', 'ASSET',     NULL, NULL, 'Créances sur l’agrégateur (encaissements en transit)'),
  ('019a0000-0000-7000-8000-000000002900', '2900', 'LIABILITY', NULL, NULL, 'Suspens à identifier'),
  ('019a0000-0000-7000-8000-000000007100', '7100', 'REVENUE',   NULL, NULL, 'Commissions marchandes acquises'),
  ('019a0000-0000-7000-8000-000000007200', '7200', 'REVENUE',   NULL, NULL, 'Commissions d’apport financeur'),
  ('019a0000-0000-7000-8000-000000007300', '7300', 'REVENUE',   NULL, NULL, 'Abonnements partenaires'),
  ('019a0000-0000-7000-8000-000000006100', '6100', 'EXPENSE',   NULL, NULL, 'Frais d’encaissement et de règlement');

-- Privilèges : insertion et lecture seulement pour l'application.
GRANT USAGE ON SCHEMA ledger TO app_rw, app_ro;
GRANT SELECT, INSERT ON ledger.account, ledger.journal_entry, ledger.posting TO app_rw;
GRANT SELECT ON ledger.account, ledger.journal_entry, ledger.posting TO app_ro;
GRANT SELECT ON ledger.account_balance TO app_rw, app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.account, ledger.journal_entry, ledger.posting FROM app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.account, ledger.journal_entry, ledger.posting FROM app_ro;
REVOKE CREATE ON SCHEMA ledger FROM PUBLIC;

COMMIT;
