-- Migration 0070 — interrupteur d'arrêt des flux financiers sortants
-- (C7, SEC-INC-003). Dépend de 0042, 0045, 0047 (instructions signées).
--
-- En cas d'incident (relevé incohérent, compromission présumée, fraude), deux
-- personnes peuvent geler les flux sortants : une demande motivée, puis une
-- confirmation par une AUTRE personne dans l'heure ; la levée suit la même
-- règle. Tant que le gel est actif, la base refuse toute nouvelle instruction
-- signée (règlement marchand, remboursement, virement au bénéficiaire C).
-- Préparations et décisions restent possibles ; les exécutions rapportées par
-- l'établissement (faits) restent enregistrables. Tout est en ajout seul ;
-- l'état courant est dérivé de la dernière confirmation.

BEGIN;

CREATE TABLE settlement.outgoing_freeze_request (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('FREEZE', 'UNFREEZE')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]'),
  requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 200 AND requested_by !~ '[[:space:]]'),
  requested_at timestamptz NOT NULL,
  CONSTRAINT outgoing_freeze_request_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE TABLE settlement.outgoing_freeze_confirmation (
  request_id uuid PRIMARY KEY REFERENCES settlement.outgoing_freeze_request (id),
  confirmed_by text NOT NULL CHECK (length(confirmed_by) BETWEEN 1 AND 200 AND confirmed_by !~ '[[:space:]]'),
  confirmed_at timestamptz NOT NULL
);

-- État courant : objet de la dernière demande confirmée (aucune : non gelé).
CREATE FUNCTION settlement.outgoing_frozen() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT r.action = 'FREEZE'
      FROM settlement.outgoing_freeze_confirmation c
      JOIN settlement.outgoing_freeze_request r ON r.id = c.request_id
     ORDER BY c.confirmed_at DESC, c.request_id DESC
     LIMIT 1
  ), false)
$fn$;

CREATE FUNCTION settlement.anchor_outgoing_freeze_request() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('settlement.outgoing-freeze', 0));
  IF (NEW.action = 'FREEZE') = settlement.outgoing_frozen() THEN
    RAISE EXCEPTION 'SETTLEMENT_FREEZE_STATE: les flux sortants sont déjà %', CASE WHEN NEW.action = 'FREEZE' THEN 'gelés' ELSE 'ouverts' END;
  END IF;
  NEW.requested_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE FUNCTION settlement.anchor_outgoing_freeze_confirmation() RETURNS trigger
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
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END $fn$;

-- Garde des instructions signées : aucune nouvelle sortie de fonds pendant le gel.
-- Nom préfixé « a0_ » : les déclencheurs d'une table s'exécutent par ordre alphabétique ;
-- le gel est vérifié avant toute autre règle de la ligne.
CREATE FUNCTION settlement.refuse_instruction_when_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('settlement.outgoing-freeze', 0));
  IF settlement.outgoing_frozen() THEN
    RAISE EXCEPTION 'SETTLEMENT_OUTGOING_FROZEN: flux sortants gelés (SEC-INC-003)';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER outgoing_freeze_request_anchor BEFORE INSERT ON settlement.outgoing_freeze_request
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_outgoing_freeze_request();
CREATE TRIGGER outgoing_freeze_request_no_update_delete BEFORE UPDATE OR DELETE ON settlement.outgoing_freeze_request
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER outgoing_freeze_request_no_truncate BEFORE TRUNCATE ON settlement.outgoing_freeze_request
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER outgoing_freeze_confirmation_anchor BEFORE INSERT ON settlement.outgoing_freeze_confirmation
  FOR EACH ROW EXECUTE FUNCTION settlement.anchor_outgoing_freeze_confirmation();
CREATE TRIGGER outgoing_freeze_confirmation_no_update_delete BEFORE UPDATE OR DELETE ON settlement.outgoing_freeze_confirmation
  FOR EACH ROW EXECUTE FUNCTION settlement.forbid_mutation();
CREATE TRIGGER outgoing_freeze_confirmation_no_truncate BEFORE TRUNCATE ON settlement.outgoing_freeze_confirmation
  FOR EACH STATEMENT EXECUTE FUNCTION settlement.forbid_mutation();

CREATE TRIGGER a0_outgoing_freeze_guard BEFORE INSERT ON settlement.payout_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.refuse_instruction_when_frozen();
CREATE TRIGGER a0_outgoing_freeze_guard BEFORE INSERT ON settlement.refund_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.refuse_instruction_when_frozen();
CREATE TRIGGER a0_outgoing_freeze_guard BEFORE INSERT ON settlement.beneficiary_payout_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement.refuse_instruction_when_frozen();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outgoing_freeze_request:outgoing_freeze_request_anchor', 'outgoing_freeze_request:outgoing_freeze_request_no_update_delete',
    'outgoing_freeze_request:outgoing_freeze_request_no_truncate', 'outgoing_freeze_confirmation:outgoing_freeze_confirmation_anchor',
    'outgoing_freeze_confirmation:outgoing_freeze_confirmation_no_update_delete', 'outgoing_freeze_confirmation:outgoing_freeze_confirmation_no_truncate',
    'payout_instruction:a0_outgoing_freeze_guard', 'refund_instruction:a0_outgoing_freeze_guard',
    'beneficiary_payout_instruction:a0_outgoing_freeze_guard'
  ] LOOP
    EXECUTE format('ALTER TABLE settlement.%I ENABLE ALWAYS TRIGGER %I', split_part(t, ':', 1), split_part(t, ':', 2));
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION settlement.anchor_outgoing_freeze_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.anchor_outgoing_freeze_confirmation() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.refuse_instruction_when_frozen() FROM PUBLIC;
REVOKE ALL ON FUNCTION settlement.outgoing_frozen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.outgoing_frozen() TO app_rw, app_ro;
GRANT SELECT, INSERT ON settlement.outgoing_freeze_request, settlement.outgoing_freeze_confirmation TO app_rw;
GRANT SELECT ON settlement.outgoing_freeze_request, settlement.outgoing_freeze_confirmation TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON settlement.outgoing_freeze_request, settlement.outgoing_freeze_confirmation FROM app_rw, app_ro;

COMMIT;
