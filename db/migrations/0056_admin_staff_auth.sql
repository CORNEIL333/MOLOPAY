-- Migration 0056 — personnel interne : comptes, rôles, clés WebAuthn, défis,
-- assertions et sessions (lot 21 : SEC-AUTH-004/005, SEC-AUTHZ-001/003, D62,
-- ADR-0007 proposé). Dépend de 0003 (admin.approval_request/decision).
--
-- Tout est en ajout seul. Un compte et ses rôles naissent d'une demande
-- ROLE_GRANT approuvée par une autre personne (SEC-AUTHZ-003) dont la base
-- vérifie le contenu exact ; une nouvelle attribution remplace la précédente ;
-- la désactivation (restrictive) est faite par une seule personne motivée.
-- Enrôlement d'une clé : défi REGISTER portant l'empreinte d'un jeton remis
-- hors bande. Défis à usage unique, valables 5 minutes. Compteur d'assertion
-- strictement croissant (clone détecté). Sessions de 15 minutes au plus
-- (plus strict que 15 minutes d'inactivité, SEC-AUTH-005), révocables.
-- La vérification cryptographique (WebAuthn) est faite par l'application
-- (PostgreSQL n'a ni ES256 ni la lecture de clientDataJSON).

BEGIN;

CREATE TABLE admin.staff_account (
  id uuid PRIMARY KEY,
  login text NOT NULL UNIQUE CHECK (login ~ '^[a-z][a-z0-9._-]{2,63}$'),
  approval_request_id uuid NOT NULL UNIQUE REFERENCES admin.approval_request (id),
  created_at timestamptz NOT NULL,
  CONSTRAINT staff_account_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

CREATE TABLE admin.staff_role_grant (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES admin.staff_account (id),
  roles text[] NOT NULL CHECK (
    cardinality(roles) BETWEEN 1 AND 9
    AND roles <@ ARRAY['SUPPORT_N1', 'SUPPORT_N2', 'OPERATIONS', 'FINANCE', 'COMPLIANCE', 'RISK',
                       'PARTNER_NETWORK', 'AUDIT', 'TECH_ADMIN']::text[]
  ),
  city_ids text[] NOT NULL CHECK (city_ids <@ ARRAY['yaounde', 'douala']::text[]),
  max_amount_xaf bigint NULL CHECK (max_amount_xaf IS NULL OR max_amount_xaf > 0),
  approval_request_id uuid NOT NULL UNIQUE REFERENCES admin.approval_request (id),
  granted_at timestamptz NOT NULL
);
CREATE INDEX staff_role_grant_staff_idx ON admin.staff_role_grant (staff_id, granted_at DESC);

CREATE TABLE admin.staff_disable (
  staff_id uuid PRIMARY KEY REFERENCES admin.staff_account (id),
  disabled_by text NOT NULL CHECK (length(disabled_by) BETWEEN 1 AND 200 AND disabled_by !~ '[[:space:]]'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  disabled_at timestamptz NOT NULL
);

CREATE TABLE admin.staff_challenge (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES admin.staff_account (id),
  purpose text NOT NULL CHECK (purpose IN ('REGISTER', 'LOGIN')),
  challenge bytea NOT NULL UNIQUE CHECK (octet_length(challenge) = 32),
  enrollment_token_hash bytea NULL CHECK (enrollment_token_hash IS NULL OR octet_length(enrollment_token_hash) = 32),
  issued_by text NOT NULL CHECK (length(issued_by) BETWEEN 1 AND 200 AND issued_by !~ '[[:space:]]'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT staff_challenge_enrollment CHECK ((purpose = 'REGISTER') = (enrollment_token_hash IS NOT NULL))
);

CREATE TABLE admin.staff_challenge_use (
  challenge_id uuid PRIMARY KEY REFERENCES admin.staff_challenge (id),
  used_at timestamptz NOT NULL
);

CREATE TABLE admin.staff_credential (
  credential_id bytea PRIMARY KEY CHECK (octet_length(credential_id) BETWEEN 16 AND 1023),
  staff_id uuid NOT NULL REFERENCES admin.staff_account (id),
  public_key_spki bytea NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('ES256', 'EdDSA')),
  sign_count bigint NOT NULL CHECK (sign_count >= 0),
  challenge_id uuid NOT NULL UNIQUE REFERENCES admin.staff_challenge_use (challenge_id),
  registered_at timestamptz NOT NULL
);

CREATE TABLE admin.staff_assertion (
  id uuid PRIMARY KEY,
  credential_id bytea NOT NULL REFERENCES admin.staff_credential (credential_id),
  sign_count bigint NOT NULL CHECK (sign_count >= 0),
  challenge_id uuid NOT NULL UNIQUE REFERENCES admin.staff_challenge_use (challenge_id),
  asserted_at timestamptz NOT NULL
);

CREATE TABLE admin.staff_session (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES admin.staff_account (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  assertion_id uuid NOT NULL UNIQUE REFERENCES admin.staff_assertion (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE admin.staff_session_revocation (
  session_id uuid PRIMARY KEY REFERENCES admin.staff_session (id),
  revoked_at timestamptz NOT NULL
);

-- Demande ROLE_GRANT approuvée, préparée et décidée par deux personnes, dont la charge égale exactement l'attribution.
CREATE FUNCTION admin.assert_role_grant_request(p_request uuid, p_payload jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  request_kind text;
  request_payload jsonb;
  request_decision text;
BEGIN
  SELECT r.kind, r.payload, d.decision INTO request_kind, request_payload, request_decision
  FROM admin.approval_request r LEFT JOIN admin.approval_decision d ON d.request_id = r.id
  WHERE r.id = p_request;
  IF request_kind IS DISTINCT FROM 'ROLE_GRANT' OR request_decision IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: demande ROLE_GRANT approuvée exigée';
  END IF;
  IF request_payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: attribution différente de la demande approuvée';
  END IF;
END $$;

CREATE FUNCTION admin.anchor_staff_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM admin.assert_role_grant_request(NEW.approval_request_id,
    jsonb_build_object('operation', 'CREATE_STAFF', 'staff_id', NEW.id, 'login', NEW.login));
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_role_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = NEW.staff_id) THEN
    RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: compte désactivé';
  END IF;
  PERFORM admin.assert_role_grant_request(NEW.approval_request_id,
    jsonb_build_object('operation', 'GRANT_ROLES', 'staff_id', NEW.staff_id,
      'roles', to_jsonb(NEW.roles), 'city_ids', to_jsonb(NEW.city_ids),
      'max_amount_xaf', CASE WHEN NEW.max_amount_xaf IS NULL THEN 'null'::jsonb ELSE to_jsonb(NEW.max_amount_xaf::text) END));
  NEW.granted_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_disable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.disabled_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = NEW.staff_id) THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: compte désactivé';
  END IF;
  NEW.issued_at := clock_timestamp();
  NEW.expires_at := NEW.issued_at + interval '5 minutes';
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_challenge_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT expires_at FROM admin.staff_challenge WHERE id = NEW.challenge_id) <= clock_timestamp() THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: défi expiré';
  END IF;
  NEW.used_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_credential() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  challenge_staff uuid;
  challenge_purpose text;
BEGIN
  SELECT c.staff_id, c.purpose INTO challenge_staff, challenge_purpose
  FROM admin.staff_challenge c WHERE c.id = NEW.challenge_id;
  IF challenge_purpose IS DISTINCT FROM 'REGISTER' OR challenge_staff IS DISTINCT FROM NEW.staff_id THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: défi d''enrôlement d''un autre compte ou d''un autre usage';
  END IF;
  NEW.registered_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_assertion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  credential_staff uuid;
  last_count bigint;
  challenge_staff uuid;
  challenge_purpose text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin.staff_credential:' || encode(NEW.credential_id, 'hex'), 0));
  SELECT staff_id, sign_count INTO credential_staff, last_count FROM admin.staff_credential WHERE credential_id = NEW.credential_id;
  SELECT GREATEST(last_count, COALESCE(max(a.sign_count), 0)) INTO last_count
  FROM admin.staff_assertion a WHERE a.credential_id = NEW.credential_id;
  SELECT c.staff_id, c.purpose INTO challenge_staff, challenge_purpose
  FROM admin.staff_challenge c WHERE c.id = NEW.challenge_id;
  IF challenge_purpose IS DISTINCT FROM 'LOGIN' OR challenge_staff IS DISTINCT FROM credential_staff THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: défi de connexion d''un autre compte';
  END IF;
  IF EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = credential_staff) THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: compte désactivé';
  END IF;
  IF (NEW.sign_count <> 0 OR last_count <> 0) AND NEW.sign_count <= last_count THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: compteur non croissant (clé clonée ?)';
  END IF;
  NEW.asserted_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT c.staff_id FROM admin.staff_assertion a JOIN admin.staff_credential c ON c.credential_id = a.credential_id
      WHERE a.id = NEW.assertion_id) IS DISTINCT FROM NEW.staff_id THEN
    RAISE EXCEPTION 'STAFF_AUTH_INVALID: session sans assertion du compte';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '15 minutes';
  RETURN NEW;
END $$;

CREATE FUNCTION admin.anchor_staff_session_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.revoked_at := clock_timestamp();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_account', 'staff_role_grant', 'staff_disable', 'staff_challenge', 'staff_challenge_use',
                           'staff_credential', 'staff_assertion', 'staff_session', 'staff_session_revocation'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION admin.%I() FROM PUBLIC', 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON admin.%I FOR EACH ROW EXECUTE FUNCTION admin.%I()', t || '_anchor', t, 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON admin.%I FOR EACH ROW EXECUTE FUNCTION admin.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON admin.%I FOR EACH STATEMENT EXECUTE FUNCTION admin.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE admin.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('ALTER TABLE admin.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE admin.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('GRANT SELECT, INSERT ON admin.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON admin.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON admin.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION admin.assert_role_grant_request(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.assert_role_grant_request(uuid, jsonb) TO app_rw;

COMMIT;
