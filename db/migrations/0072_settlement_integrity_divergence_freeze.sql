-- Migration 0072 — gel automatique des flux sortants sur divergence du
-- vérificateur indépendant (INT-VER-002, SEC-INC-003). Dépend de 0070.
--
-- Le contrôle nocturne (outil Rust séparé, INT-VER-001) rapporte toute
-- divergence par un rôle dédié, `integrity_reporter`, qui ne peut QUE
-- l'enregistrer. Dès l'enregistrement, les flux sortants sont gelés : la
-- garde des instructions signées (0070) les refuse. Aucune machine ne lève
-- un gel : seule une levée demandée APRÈS la divergence et confirmée par une
-- autre personne rouvre les flux (règle de 0070, inchangée).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'integrity_reporter') THEN
    CREATE ROLE integrity_reporter NOLOGIN;
  END IF;
END $$;

CREATE TABLE settlement.integrity_divergence (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('LEDGER_VERIFIER')),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  reported_by text NOT NULL,
  detected_at timestamptz NOT NULL,
  CONSTRAINT integrity_divergence_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE FUNCTION settlement.anchor_integrity_divergence() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- Même verrou que les demandes et confirmations de gel : l'ordre des faits est sans ambiguïté.
  PERFORM pg_advisory_xact_lock(hashtextextended('settlement.outgoing-freeze', 0));
  NEW.reported_by := current_user;
  NEW.detected_at := clock_timestamp();
  RETURN NEW;
END $fn$;

-- État courant : gelé si la dernière confirmation est un gel, ou si une
-- divergence est postérieure à la dernière levée confirmée.
CREATE OR REPLACE FUNCTION settlement.outgoing_frozen() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  WITH last_confirmed AS (
    SELECT r.action, c.confirmed_at
      FROM settlement.outgoing_freeze_confirmation c
      JOIN settlement.outgoing_freeze_request r ON r.id = c.request_id
     ORDER BY c.confirmed_at DESC, c.request_id DESC
     LIMIT 1
  )
  SELECT COALESCE((SELECT l.action = 'FREEZE' FROM last_confirmed l), false)
      OR EXISTS (
        SELECT 1 FROM settlement.integrity_divergence d
         WHERE d.detected_at > COALESCE((
           SELECT max(c.confirmed_at) FROM settlement.outgoing_freeze_confirmation c
             JOIN settlement.outgoing_freeze_request r ON r.id = c.request_id
            WHERE r.action = 'UNFREEZE'), '-infinity'::timestamptz)
      )
$fn$;

-- Confirmation (reprise de 0070) : une levée demandée AVANT une divergence ne
-- peut pas l'effacer ; il faut une nouvelle demande, faite en connaissance de cause.
CREATE OR REPLACE FUNCTION settlement.anchor_outgoing_freeze_confirmation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  request record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settlement.outgoing-freeze', 0));
  SELECT r.action, r.requested_by, r.requested_at INTO request FROM settlement.outgoing_freeze_request r WHERE r.id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND: demande de gel inconnue';
  END IF;
  IF request.requested_by = NEW.confirmed_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: l''auteur de la demande ne peut pas la confirmer';
  END IF;
  IF clock_timestamp() > request.requested_at + interval '1 hour' THEN
    RAISE EXCEPTION 'SETTLEMENT_FREEZE_EXPIRED: demande de plus d''une heure, à renouveler';
  END IF;
  IF (request.action = 'FREEZE') = settlement.outgoing_frozen() THEN
    RAISE EXCEPTION 'SETTLEMENT_FREEZE_STATE: état déjà atteint par une autre demande';
  END IF;
  IF request.action = 'UNFREEZE' AND EXISTS (
    SELECT 1 FROM settlement.integrity_divergence d WHERE d.detected_at > request.requested_at
  ) THEN
    RAISE EXCEPTION 'SETTLEMENT_FREEZE_STATE: divergence d''intégrité postérieure à la demande de levée, à renouveler';
  END IF;
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE TRIGGER integrity_divergence_anchor BEFORE INSERT ON settlement.integrity_divergence
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_integrity_divergence();
CREATE TRIGGER integrity_divergence_no_update_delete BEFORE UPDATE OR DELETE ON settlement.integrity_divergence
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER integrity_divergence_no_truncate BEFORE TRUNCATE ON settlement.integrity_divergence
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();
ALTER TABLE settlement.integrity_divergence ENABLE ALWAYS TRIGGER integrity_divergence_anchor;
ALTER TABLE settlement.integrity_divergence ENABLE ALWAYS TRIGGER integrity_divergence_no_update_delete;
ALTER TABLE settlement.integrity_divergence ENABLE ALWAYS TRIGGER integrity_divergence_no_truncate;

REVOKE ALL ON FUNCTION settlement.anchor_integrity_divergence() FROM PUBLIC;
REVOKE ALL ON settlement.integrity_divergence FROM PUBLIC;
GRANT USAGE ON SCHEMA settlement TO integrity_reporter;
GRANT INSERT ON settlement.integrity_divergence TO integrity_reporter;
GRANT SELECT ON settlement.integrity_divergence TO app_rw, app_ro;

COMMIT;
