-- Migration 0100 — CRM : interactions de support et tâches de suivi (Q5).
-- Dépend de 0004 (identity) et 0002 (audit).
--
-- Fiche client 360° : les échanges avec le support et les tâches de suivi
-- s'ajoutent, ne se modifient ni ne s'effacent. L'état d'une tâche se dérive
-- de ses événements (OUVERTE, puis CLOSE ou ANNULÉE), jamais d'une colonne
-- mutable (I-9). Aucune donnée d'identité n'est recopiée : le CRM renvoie à
-- `identity.account`, seule source du numéro masqué et du niveau KYC.
-- Rien ne s'écrit directement dans les tables : seules les fonctions
-- d'écriture, exécutées avec les droits du propriétaire, valident et tracent.

BEGIN;

CREATE SCHEMA IF NOT EXISTS crm;
REVOKE ALL ON SCHEMA crm FROM PUBLIC;
GRANT USAGE ON SCHEMA crm TO app_rw, app_ro;

-- UUID v7 : 48 bits d'horodatage en millisecondes, puis aléa (RFC 9562).
CREATE FUNCTION crm.new_uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $fn$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid
$fn$;

CREATE TABLE crm.interaction (
  id uuid PRIMARY KEY CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  account_id uuid NOT NULL REFERENCES identity.account(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'WALK_IN', 'APP', 'OTHER')),
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  summary text NOT NULL CHECK (summary = btrim(summary) AND length(summary) BETWEEN 3 AND 2000 AND summary !~ '[[:cntrl:]]'),
  outcome text CHECK (
    outcome IS NULL
    OR (outcome = btrim(outcome) AND length(outcome) BETWEEN 3 AND 500 AND outcome !~ '[[:cntrl:]]')
  ),
  actor_id text NOT NULL CHECK (actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 200 AND actor_id !~ '[[:cntrl:]]'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX interaction_account_idx ON crm.interaction (account_id, recorded_at DESC, id DESC);

CREATE TABLE crm.follow_up_task (
  id uuid PRIMARY KEY CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  account_id uuid NOT NULL REFERENCES identity.account(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (title = btrim(title) AND length(title) BETWEEN 3 AND 200 AND title !~ '[[:cntrl:]]'),
  details text CHECK (
    details IS NULL
    OR (details = btrim(details) AND length(details) BETWEEN 3 AND 2000 AND details !~ '[[:cntrl:]]')
  ),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  assignee_id text NOT NULL CHECK (assignee_id = btrim(assignee_id) AND length(assignee_id) BETWEEN 1 AND 200 AND assignee_id !~ '[[:cntrl:]]'),
  due_at timestamptz,
  created_by text NOT NULL CHECK (created_by = btrim(created_by) AND length(created_by) BETWEEN 1 AND 200 AND created_by !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX follow_up_task_account_idx ON crm.follow_up_task (account_id, created_at DESC, id DESC);
CREATE INDEX follow_up_task_assignee_idx ON crm.follow_up_task (assignee_id, due_at);

-- L'état d'une tâche est le dernier événement ; l'ouverture est le premier.
CREATE TABLE crm.follow_up_task_event (
  id uuid PRIMARY KEY CHECK (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  task_id uuid NOT NULL REFERENCES crm.follow_up_task(id) ON DELETE RESTRICT,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 1000),
  kind text NOT NULL CHECK (kind IN ('OPENED', 'COMPLETED', 'CANCELLED')),
  note text CHECK (
    note IS NULL
    OR (note = btrim(note) AND length(note) BETWEEN 3 AND 1000 AND note !~ '[[:cntrl:]]')
  ),
  actor_id text NOT NULL CHECK (actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 200 AND actor_id !~ '[[:cntrl:]]'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (task_id, seq),
  CHECK ((kind = 'OPENED') = (seq = 1)),
  CHECK (kind = 'OPENED' OR note IS NOT NULL)
);

CREATE FUNCTION crm.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'CRM_APPEND_ONLY: registre CRM en ajout seul';
END $fn$;

CREATE TRIGGER interaction_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON crm.interaction
  FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_mutation();
CREATE TRIGGER follow_up_task_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON crm.follow_up_task
  FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_mutation();
CREATE TRIGGER follow_up_task_event_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON crm.follow_up_task_event
  FOR EACH STATEMENT EXECUTE FUNCTION crm.reject_mutation();
ALTER TABLE crm.interaction ENABLE ALWAYS TRIGGER interaction_append_only;
ALTER TABLE crm.follow_up_task ENABLE ALWAYS TRIGGER follow_up_task_append_only;
ALTER TABLE crm.follow_up_task_event ENABLE ALWAYS TRIGGER follow_up_task_event_append_only;

-- Interaction : le compte doit exister ; l'instant de l'échange est fourni par
-- l'agent (avec une tolérance d'horloge de 5 minutes vers le futur), l'instant
-- d'inscription est celui de la base.
CREATE FUNCTION crm.record_interaction(
  p_id uuid,
  p_account uuid,
  p_channel text,
  p_direction text,
  p_summary text,
  p_outcome text,
  p_actor text,
  p_occurred_at timestamptz
) RETURNS TABLE (interaction_id uuid, recorded_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  instant timestamptz := clock_timestamp();
BEGIN
  IF p_id IS NULL OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: identifiant d''interaction invalide';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'WALK_IN', 'APP', 'OTHER') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: canal d''échange inconnu';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('INBOUND', 'OUTBOUND') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: sens de l''échange inconnu';
  END IF;
  IF p_summary IS NULL OR length(btrim(p_summary)) NOT BETWEEN 3 AND 2000 OR p_summary ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: résumé de l''échange invalide';
  END IF;
  IF p_outcome IS NOT NULL AND (length(btrim(p_outcome)) NOT BETWEEN 3 AND 500 OR p_outcome ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: issue de l''échange invalide';
  END IF;
  IF p_actor IS NULL OR p_actor <> btrim(p_actor) OR length(p_actor) NOT BETWEEN 1 AND 200 OR p_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: agent invalide';
  END IF;
  IF p_occurred_at IS NULL OR p_occurred_at > instant + interval '5 minutes' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: instant de l''échange hors bornes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.account a WHERE a.id = p_account) THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_NOT_FOUND: compte client inconnu';
  END IF;
  RETURN QUERY
    INSERT INTO crm.interaction (id, account_id, channel, direction, summary, outcome, actor_id, occurred_at)
    VALUES (p_id, p_account, p_channel, p_direction, btrim(p_summary), NULLIF(btrim(COALESCE(p_outcome, '')), ''), p_actor, p_occurred_at)
    RETURNING interaction.id, interaction.recorded_at;
END $fn$;

-- Tâche : créée ouverte par son premier événement, dans la même écriture.
CREATE FUNCTION crm.create_follow_up_task(
  p_id uuid,
  p_account uuid,
  p_title text,
  p_details text,
  p_priority text,
  p_assignee text,
  p_due_at timestamptz,
  p_actor text
) RETURNS TABLE (task_id uuid, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  instant timestamptz := clock_timestamp();
  opened_id uuid := crm.new_uuid_v7();
BEGIN
  IF p_id IS NULL OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: identifiant de tâche invalide';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 3 AND 200 OR p_title ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: intitulé de tâche invalide';
  END IF;
  IF p_details IS NOT NULL AND (length(btrim(p_details)) NOT BETWEEN 3 AND 2000 OR p_details ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: détail de tâche invalide';
  END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('LOW', 'NORMAL', 'HIGH') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: priorité inconnue';
  END IF;
  IF p_assignee IS NULL OR p_assignee <> btrim(p_assignee) OR length(p_assignee) NOT BETWEEN 1 AND 200 OR p_assignee ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: destinataire invalide';
  END IF;
  IF p_actor IS NULL OR p_actor <> btrim(p_actor) OR length(p_actor) NOT BETWEEN 1 AND 200 OR p_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: agent invalide';
  END IF;
  IF p_due_at IS NOT NULL AND p_due_at < instant - interval '1 day' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: échéance antérieure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.account a WHERE a.id = p_account) THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_NOT_FOUND: compte client inconnu';
  END IF;
  INSERT INTO crm.follow_up_task (id, account_id, title, details, priority, assignee_id, due_at, created_by)
  VALUES (p_id, p_account, btrim(p_title), NULLIF(btrim(COALESCE(p_details, '')), ''), p_priority, p_assignee, p_due_at, p_actor);
  INSERT INTO crm.follow_up_task_event (id, task_id, seq, kind, note, actor_id)
  VALUES (opened_id, p_id, 1, 'OPENED', NULL, p_actor);
  RETURN QUERY
    SELECT t.id, t.created_at FROM crm.follow_up_task t WHERE t.id = p_id;
END $fn$;

-- Transition : seule une tâche OUVERTE se ferme, une fois, avec un motif.
CREATE FUNCTION crm.transition_follow_up_task(
  p_event_id uuid,
  p_task_id uuid,
  p_kind text,
  p_actor text,
  p_note text
) RETURNS TABLE (task_id uuid, seq integer, kind text, recorded_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  current_kind text;
  next_seq integer;
BEGIN
  IF p_event_id IS NULL OR p_event_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: identifiant d''événement invalide';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: transition inconnue';
  END IF;
  IF p_actor IS NULL OR p_actor <> btrim(p_actor) OR length(p_actor) NOT BETWEEN 1 AND 200 OR p_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: agent invalide';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 1000 OR p_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'CRM_INVALID_REQUEST: motif de clôture invalide';
  END IF;
  PERFORM 1 FROM crm.follow_up_task t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM_TASK_NOT_FOUND: tâche de suivi inconnue';
  END IF;
  SELECT e.kind INTO current_kind FROM crm.follow_up_task_event e WHERE e.task_id = p_task_id ORDER BY e.seq DESC LIMIT 1;
  IF current_kind <> 'OPENED' THEN
    RAISE EXCEPTION 'CRM_TASK_CLOSED: tâche de suivi déjà close';
  END IF;
  SELECT COALESCE(max(e.seq), 0) + 1 INTO next_seq FROM crm.follow_up_task_event e WHERE e.task_id = p_task_id;
  RETURN QUERY
    INSERT INTO crm.follow_up_task_event (id, task_id, seq, kind, note, actor_id)
    VALUES (p_event_id, p_task_id, next_seq, p_kind, btrim(p_note), p_actor)
    RETURNING follow_up_task_event.task_id, follow_up_task_event.seq, follow_up_task_event.kind, follow_up_task_event.recorded_at;
END $fn$;

-- Écriture réservée aux fonctions ; lecture seule pour l'application.
REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM PUBLIC, app_ro, app_rw;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm FROM PUBLIC, app_ro, app_rw;
GRANT SELECT ON crm.interaction, crm.follow_up_task, crm.follow_up_task_event TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION crm.record_interaction(uuid, uuid, text, text, text, text, text, timestamptz) TO app_rw;
GRANT EXECUTE ON FUNCTION crm.create_follow_up_task(uuid, uuid, text, text, text, text, timestamptz, text) TO app_rw;
GRANT EXECUTE ON FUNCTION crm.transition_follow_up_task(uuid, uuid, text, text, text) TO app_rw;

COMMIT;
