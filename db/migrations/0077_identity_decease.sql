-- Migration 0077 — décès d'un client, tranche 1 : déclaration, décision par une
-- autre personne, gel (C19, F-ACC-007). Dépend de 0004, 0011, 0046, 0068.
--
-- Déclaration : motivée, avec la date du décès et l'EMPREINTE SHA-256 de l'acte
-- (la pièce reste au dossier papier ou chiffré de la conformité ; minimisation,
-- REG-DPD-003). Un seul dossier en attente ou approuvé par compte.
-- Décision : par une AUTRE personne que le déclarant (I-7), une seule fois,
-- rejet motivé. À l'approbation, dans la même transaction que la décision :
--   - compte BLOQUÉ définitivement (canal DECEASED), appareils révoqués,
--     sessions fermées ;
--   - objectifs ACTIFS gelés (ACTIVE → FROZEN, au nom du décideur).
-- Ensuite, plus aucune modification de l'état, du canal ni du numéro du compte,
-- et plus aucune récupération de compte (même par un rôle de confiance).
-- La restitution des fonds aux ayants droit (tranche 2) attend les décisions
-- du fondateur (D116) : aucun mouvement sortant n'est créé ici.

BEGIN;

ALTER TABLE identity.account DROP CONSTRAINT account_block_channel_check;
ALTER TABLE identity.account ADD CONSTRAINT account_block_channel_check CHECK (
  block_channel IS NULL OR block_channel IN ('USSD', 'SUPPORT', 'TRUSTED_DEVICE', 'APP', 'DECEASED')
);

CREATE TABLE identity.decease_case (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES identity.account (id),
  death_date date NOT NULL,
  certificate_sha256 bytea NOT NULL CHECK (octet_length(certificate_sha256) = 32),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  declared_by text NOT NULL CHECK (length(declared_by) BETWEEN 1 AND 200 AND declared_by !~ '[[:space:]]'),
  declared_at timestamptz NOT NULL,
  CONSTRAINT decease_case_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7'
    AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);
CREATE INDEX decease_case_account_idx ON identity.decease_case (account_id);

CREATE TABLE identity.decease_decision (
  case_id uuid PRIMARY KEY REFERENCES identity.decease_case (id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 200 AND decided_by !~ '[[:space:]]'),
  reason text NULL CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 1000),
  frozen_goals integer NOT NULL CHECK (frozen_goals >= 0),
  decided_at timestamptz NOT NULL,
  CONSTRAINT decease_rejection_reason CHECK (decision <> 'REJECTED' OR reason IS NOT NULL),
  CONSTRAINT decease_rejection_freezes_nothing CHECK (decision <> 'REJECTED' OR frozen_goals = 0)
);

-- Compte décédé : approuvé = une décision APPROVED existe.
CREATE FUNCTION identity.is_deceased(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM identity.decease_case c JOIN identity.decease_decision d ON d.case_id = c.id
     WHERE c.account_id = p_account AND d.decision = 'APPROVED'
  )
$fn$;

CREATE FUNCTION identity.anchor_decease_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  -- Un dossier à la fois par compte (verrou consultatif : app_rw n'a pas le droit de verrouiller le compte).
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.decease:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM identity.account a WHERE a.id = NEW.account_id) THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_NOT_FOUND: compte client inconnu';
  END IF;
  IF NEW.death_date > (clock_timestamp() AT TIME ZONE 'Africa/Douala')::date THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: date de décès dans le futur';
  END IF;
  IF EXISTS (
    SELECT 1 FROM identity.decease_case c LEFT JOIN identity.decease_decision d ON d.case_id = c.id
     WHERE c.account_id = NEW.account_id AND (d.case_id IS NULL OR d.decision = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'IDENTITY_DECEASE_CASE_EXISTS: un dossier de décès est déjà ouvert ou approuvé pour ce compte';
  END IF;
  NEW.reason := btrim(NEW.reason);
  NEW.declared_at := clock_timestamp();
  RETURN NEW;
END $fn$;

-- SECURITY DEFINER : seule cette décision peut bloquer pour décès (colonnes
-- d'état retirées à app_rw par 0023) et elle seule le fait.
CREATE FUNCTION identity.apply_decease_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  dossier identity.decease_case%ROWTYPE;
  instant timestamptz := clock_timestamp();
  goal record;
  frozen integer := 0;
BEGIN
  SELECT * INTO dossier FROM identity.decease_case c WHERE c.id = NEW.case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IDENTITY_DECEASE_CASE_NOT_FOUND: dossier de décès inconnu';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.decease:' || dossier.account_id::text, 0));
  IF EXISTS (SELECT 1 FROM identity.decease_decision d WHERE d.case_id = NEW.case_id) THEN
    RAISE EXCEPTION 'IDENTITY_DECEASE_ALREADY_DECIDED: dossier déjà décidé';
  END IF;
  IF NEW.decided_by = dossier.declared_by THEN
    RAISE EXCEPTION 'MAKER_CANNOT_APPROVE: le déclarant ne peut pas décider';
  END IF;
  IF NEW.decision = 'REJECTED' AND (NEW.reason IS NULL OR length(btrim(NEW.reason)) < 3) THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: un rejet doit être motivé';
  END IF;
  NEW.reason := NULLIF(btrim(NEW.reason), '');
  NEW.decided_at := instant;
  NEW.frozen_goals := 0;
  IF NEW.decision = 'REJECTED' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM identity.account a WHERE a.id = dossier.account_id FOR UPDATE;
  UPDATE identity.account
     SET status = 'BLOCKED', blocked_at = instant, block_channel = 'DECEASED', block_reason = 'DECEASED'
   WHERE id = dossier.account_id;
  UPDATE identity.device SET status = 'REVOKED', revoked_at = instant WHERE account_id = dossier.account_id AND status = 'ACTIVE';
  UPDATE identity.session SET revoked_at = instant WHERE account_id = dossier.account_id AND revoked_at IS NULL;

  FOR goal IN
    SELECT s.id, (SELECT max(e.seq) FROM agreements.status_event e WHERE e.agreement_id = s.id) AS seq
      FROM agreements.agreement_state s
     WHERE s.customer_id = dossier.account_id AND s.status = 'ACTIVE'
     ORDER BY s.id
  LOOP
    INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
    VALUES (goal.id, goal.seq + 1, 'TRANSITION', 'ACTIVE', 'FROZEN', NULL, NULL, NEW.decided_by, instant);
    frozen := frozen + 1;
  END LOOP;
  NEW.frozen_goals := frozen;
  RETURN NEW;
END $fn$;

CREATE FUNCTION identity.forbid_decease_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $fn$;

-- Compte décédé : état, canal, motif, date de blocage et numéro figés.
CREATE FUNCTION identity.guard_deceased_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF (NEW.status, NEW.block_channel, NEW.block_reason, NEW.blocked_at, NEW.phone)
       IS DISTINCT FROM (OLD.status, OLD.block_channel, OLD.block_reason, OLD.blocked_at, OLD.phone)
     AND identity.is_deceased(OLD.id) THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_DECEASED: compte d''un client décédé, aucune modification';
  END IF;
  RETURN NEW;
END $fn$;

CREATE FUNCTION identity.guard_deceased_recovery() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF identity.is_deceased(NEW.account_id) THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_DECEASED: récupération refusée pour le compte d''un client décédé';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER decease_case_anchor BEFORE INSERT ON identity.decease_case
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_decease_case();
CREATE TRIGGER decease_case_no_update_delete BEFORE UPDATE OR DELETE ON identity.decease_case
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_decease_mutation();
CREATE TRIGGER decease_case_no_truncate BEFORE TRUNCATE ON identity.decease_case
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_decease_mutation();
CREATE TRIGGER decease_decision_apply BEFORE INSERT ON identity.decease_decision
  FOR EACH ROW EXECUTE FUNCTION identity.apply_decease_decision();
CREATE TRIGGER decease_decision_no_update_delete BEFORE UPDATE OR DELETE ON identity.decease_decision
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_decease_mutation();
CREATE TRIGGER decease_decision_no_truncate BEFORE TRUNCATE ON identity.decease_decision
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_decease_mutation();
CREATE TRIGGER a0_account_deceased_guard BEFORE UPDATE ON identity.account
  FOR EACH ROW EXECUTE FUNCTION identity.guard_deceased_account();
CREATE TRIGGER a0_recovery_deceased_guard BEFORE INSERT ON identity.recovery
  FOR EACH ROW EXECUTE FUNCTION identity.guard_deceased_recovery();

ALTER TABLE identity.decease_case ENABLE ALWAYS TRIGGER decease_case_anchor;
ALTER TABLE identity.decease_case ENABLE ALWAYS TRIGGER decease_case_no_update_delete;
ALTER TABLE identity.decease_case ENABLE ALWAYS TRIGGER decease_case_no_truncate;
ALTER TABLE identity.decease_decision ENABLE ALWAYS TRIGGER decease_decision_apply;
ALTER TABLE identity.decease_decision ENABLE ALWAYS TRIGGER decease_decision_no_update_delete;
ALTER TABLE identity.decease_decision ENABLE ALWAYS TRIGGER decease_decision_no_truncate;
ALTER TABLE identity.account ENABLE ALWAYS TRIGGER a0_account_deceased_guard;
ALTER TABLE identity.recovery ENABLE ALWAYS TRIGGER a0_recovery_deceased_guard;

REVOKE ALL ON FUNCTION identity.is_deceased(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.anchor_decease_case() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.apply_decease_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.forbid_decease_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.guard_deceased_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.guard_deceased_recovery() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.is_deceased(uuid) TO app_rw, app_ro;

GRANT SELECT, INSERT ON identity.decease_case, identity.decease_decision TO app_rw;
GRANT SELECT ON identity.decease_case, identity.decease_decision TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON identity.decease_case, identity.decease_decision FROM app_rw, app_ro;

COMMIT;
