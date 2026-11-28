-- Migration 0057 — comptes nominatifs des partenaires, clés WebAuthn, défis,
-- assertions et sessions (lot 20 : SEC-AUTH-006, SEC-AUTH-005, F-PRT-003,
-- SEC-AUTHZ-003, D63). Dépend de 0003 (admin.approval_request/decision),
-- 0008 et 0015 (catalog.partner_state).
--
-- Espace distinct du personnel interne (0056) : une session partenaire ne
-- vaut jamais session du personnel. Tout est en ajout seul.
-- Gérant : né d'une demande PARTNER_APPROVAL approuvée par une autre personne
-- dont la base vérifie la charge exacte. Vendeur : créé par un gérant actif
-- du même partenaire (F-PRT-003). Réservé aux marchands validés.
-- Désactivation restrictive : un gérant ne désactive que ses vendeurs ; un
-- gérant n'est désactivé que par le personnel interne.
-- Enrôlement : défi REGISTER portant l'empreinte d'un jeton remis hors bande,
-- émis par le personnel (gérant) ou par un gérant du même partenaire
-- (vendeur). Défis à usage unique de 5 min ; compteur strictement croissant ;
-- sessions de 15 min au plus, révocables. La vérification WebAuthn est faite
-- par l'application.

BEGIN;

CREATE TABLE catalog.partner_user (
  id uuid PRIMARY KEY,
  partner_id text NOT NULL CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  login text NOT NULL UNIQUE CHECK (login ~ '^[a-z][a-z0-9._-]{2,63}$'),
  role text NOT NULL CHECK (role IN ('MANAGER', 'SELLER')),
  approval_request_id uuid NULL UNIQUE REFERENCES admin.approval_request (id),
  created_by_user uuid NULL REFERENCES catalog.partner_user (id),
  created_at timestamptz NOT NULL,
  UNIQUE (id, partner_id),
  CONSTRAINT partner_user_uuid_v7 CHECK (
    substring(id::text FROM 15 FOR 1) = '7' AND substring(id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT partner_user_origin CHECK (
    (role = 'MANAGER' AND approval_request_id IS NOT NULL AND created_by_user IS NULL)
    OR (role = 'SELLER' AND approval_request_id IS NULL AND created_by_user IS NOT NULL)
  )
);
CREATE INDEX partner_user_partner_idx ON catalog.partner_user (partner_id);

CREATE TABLE catalog.partner_user_disable (
  user_id uuid PRIMARY KEY REFERENCES catalog.partner_user (id),
  disabled_by_user uuid NULL REFERENCES catalog.partner_user (id),
  disabled_by_staff text NULL CHECK (
    disabled_by_staff IS NULL OR (length(disabled_by_staff) BETWEEN 1 AND 200 AND disabled_by_staff !~ '[[:space:]]')
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  disabled_at timestamptz NOT NULL,
  CONSTRAINT partner_user_disable_one_actor CHECK ((disabled_by_user IS NULL) <> (disabled_by_staff IS NULL))
);

CREATE TABLE catalog.partner_challenge (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES catalog.partner_user (id),
  purpose text NOT NULL CHECK (purpose IN ('REGISTER', 'LOGIN')),
  challenge bytea NOT NULL UNIQUE CHECK (octet_length(challenge) = 32),
  enrollment_token_hash bytea NULL CHECK (enrollment_token_hash IS NULL OR octet_length(enrollment_token_hash) = 32),
  issued_by_user uuid NULL REFERENCES catalog.partner_user (id),
  issued_by_staff text NULL CHECK (
    issued_by_staff IS NULL OR (length(issued_by_staff) BETWEEN 1 AND 200 AND issued_by_staff !~ '[[:space:]]')
  ),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT partner_challenge_enrollment CHECK ((purpose = 'REGISTER') = (enrollment_token_hash IS NOT NULL)),
  CONSTRAINT partner_challenge_issuer CHECK (
    (purpose = 'LOGIN' AND issued_by_user IS NULL AND issued_by_staff IS NULL)
    OR (purpose = 'REGISTER' AND (issued_by_user IS NULL) <> (issued_by_staff IS NULL))
  )
);

CREATE TABLE catalog.partner_challenge_use (
  challenge_id uuid PRIMARY KEY REFERENCES catalog.partner_challenge (id),
  used_at timestamptz NOT NULL
);

CREATE TABLE catalog.partner_credential (
  credential_id bytea PRIMARY KEY CHECK (octet_length(credential_id) BETWEEN 16 AND 1023),
  user_id uuid NOT NULL REFERENCES catalog.partner_user (id),
  public_key_spki bytea NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('ES256', 'EdDSA')),
  sign_count bigint NOT NULL CHECK (sign_count >= 0),
  challenge_id uuid NOT NULL UNIQUE REFERENCES catalog.partner_challenge_use (challenge_id),
  registered_at timestamptz NOT NULL
);

CREATE TABLE catalog.partner_assertion (
  id uuid PRIMARY KEY,
  credential_id bytea NOT NULL REFERENCES catalog.partner_credential (credential_id),
  sign_count bigint NOT NULL CHECK (sign_count >= 0),
  challenge_id uuid NOT NULL UNIQUE REFERENCES catalog.partner_challenge_use (challenge_id),
  asserted_at timestamptz NOT NULL
);

CREATE TABLE catalog.partner_session (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES catalog.partner_user (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  assertion_id uuid NOT NULL UNIQUE REFERENCES catalog.partner_assertion (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE catalog.partner_session_revocation (
  session_id uuid PRIMARY KEY REFERENCES catalog.partner_session (id),
  revoked_at timestamptz NOT NULL
);

-- Vrai si l'utilisateur est un gérant non désactivé du partenaire donné.
CREATE FUNCTION catalog.is_active_partner_manager(p_user uuid, p_partner text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM catalog.partner_user u
     WHERE u.id = p_user AND u.partner_id = p_partner AND u.role = 'MANAGER'
       AND NOT EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = u.id)
  )
$$;

CREATE FUNCTION catalog.anchor_partner_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  state_status text;
  state_type text;
  request_kind text;
  request_payload jsonb;
  request_decision text;
BEGIN
  SELECT s.status, s.partner_type INTO state_status, state_type
  FROM catalog.partner_state s WHERE s.partner_id = NEW.partner_id;
  IF state_status IS DISTINCT FROM 'VALIDATED' OR state_type IS DISTINCT FROM 'MERCHANT' THEN
    RAISE EXCEPTION 'CATALOG_INVALID_REQUEST: comptes réservés à un marchand validé';
  END IF;
  IF NEW.role = 'MANAGER' THEN
    SELECT r.kind, r.payload, d.decision INTO request_kind, request_payload, request_decision
    FROM admin.approval_request r LEFT JOIN admin.approval_decision d ON d.request_id = r.id
    WHERE r.id = NEW.approval_request_id;
    IF request_kind IS DISTINCT FROM 'PARTNER_APPROVAL' OR request_decision IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: demande PARTNER_APPROVAL approuvée exigée';
    END IF;
    IF request_payload IS DISTINCT FROM jsonb_build_object(
         'operation', 'CREATE_PARTNER_MANAGER', 'partner_id', NEW.partner_id, 'user_id', NEW.id, 'login', NEW.login) THEN
      RAISE EXCEPTION 'ADMIN_INVALID_REQUEST: compte différent de la demande approuvée';
    END IF;
  ELSIF NOT catalog.is_active_partner_manager(NEW.created_by_user, NEW.partner_id) THEN
    RAISE EXCEPTION 'PARTNER_ROLE_DENIED: vendeur créé par un gérant actif du même partenaire uniquement';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_user_disable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_partner text;
  target_role text;
BEGIN
  SELECT partner_id, role INTO target_partner, target_role FROM catalog.partner_user WHERE id = NEW.user_id;
  IF NEW.disabled_by_user IS NOT NULL
     AND (target_role IS DISTINCT FROM 'SELLER' OR NOT catalog.is_active_partner_manager(NEW.disabled_by_user, target_partner)) THEN
    RAISE EXCEPTION 'PARTNER_ROLE_DENIED: un gérant ne désactive que les vendeurs de son partenaire';
  END IF;
  NEW.disabled_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_challenge() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_partner text;
  target_role text;
BEGIN
  SELECT partner_id, role INTO target_partner, target_role FROM catalog.partner_user WHERE id = NEW.user_id;
  IF EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: compte désactivé';
  END IF;
  IF NEW.purpose = 'REGISTER' THEN
    IF target_role = 'MANAGER' AND NEW.issued_by_staff IS NULL THEN
      RAISE EXCEPTION 'PARTNER_ROLE_DENIED: l''enrôlement d''un gérant est émis par le personnel';
    END IF;
    IF target_role = 'SELLER' AND NOT catalog.is_active_partner_manager(NEW.issued_by_user, target_partner) THEN
      RAISE EXCEPTION 'PARTNER_ROLE_DENIED: l''enrôlement d''un vendeur est émis par un gérant actif du même partenaire';
    END IF;
  END IF;
  NEW.issued_at := clock_timestamp();
  NEW.expires_at := NEW.issued_at + interval '5 minutes';
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_challenge_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT expires_at FROM catalog.partner_challenge WHERE id = NEW.challenge_id) <= clock_timestamp() THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: défi expiré';
  END IF;
  NEW.used_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_credential() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  challenge_user uuid;
  challenge_purpose text;
BEGIN
  SELECT c.user_id, c.purpose INTO challenge_user, challenge_purpose
  FROM catalog.partner_challenge c WHERE c.id = NEW.challenge_id;
  IF challenge_purpose IS DISTINCT FROM 'REGISTER' OR challenge_user IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: défi d''enrôlement d''un autre compte ou d''un autre usage';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: compte désactivé';
  END IF;
  NEW.registered_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_assertion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  credential_user uuid;
  last_count bigint;
  challenge_user uuid;
  challenge_purpose text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog.partner_credential:' || encode(NEW.credential_id, 'hex'), 0));
  SELECT user_id, sign_count INTO credential_user, last_count FROM catalog.partner_credential WHERE credential_id = NEW.credential_id;
  SELECT GREATEST(last_count, COALESCE(max(a.sign_count), 0)) INTO last_count
  FROM catalog.partner_assertion a WHERE a.credential_id = NEW.credential_id;
  SELECT c.user_id, c.purpose INTO challenge_user, challenge_purpose
  FROM catalog.partner_challenge c WHERE c.id = NEW.challenge_id;
  IF challenge_purpose IS DISTINCT FROM 'LOGIN' OR challenge_user IS DISTINCT FROM credential_user THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: défi de connexion d''un autre compte';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = credential_user) THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: compte désactivé';
  END IF;
  IF (NEW.sign_count <> 0 OR last_count <> 0) AND NEW.sign_count <= last_count THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: compteur non croissant (clé clonée ?)';
  END IF;
  NEW.asserted_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT c.user_id FROM catalog.partner_assertion a JOIN catalog.partner_credential c ON c.credential_id = a.credential_id
      WHERE a.id = NEW.assertion_id) IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'PARTNER_AUTH_INVALID: session sans assertion du compte';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '15 minutes';
  RETURN NEW;
END $$;

CREATE FUNCTION catalog.anchor_partner_session_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.revoked_at := clock_timestamp();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner_user', 'partner_user_disable', 'partner_challenge', 'partner_challenge_use',
                           'partner_credential', 'partner_assertion', 'partner_session', 'partner_session_revocation'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION catalog.%I() FROM PUBLIC', 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON catalog.%I FOR EACH ROW EXECUTE FUNCTION catalog.%I()', t || '_anchor', t, 'anchor_' || t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON catalog.%I FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation()', t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON catalog.%I FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation()', t || '_no_truncate', t);
    EXECUTE format('ALTER TABLE catalog.%I ENABLE ALWAYS TRIGGER %I', t, t || '_anchor');
    EXECUTE format('ALTER TABLE catalog.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_update_delete');
    EXECUTE format('ALTER TABLE catalog.%I ENABLE ALWAYS TRIGGER %I', t, t || '_no_truncate');
    EXECUTE format('GRANT SELECT, INSERT ON catalog.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON catalog.%I TO app_ro', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON catalog.%I FROM app_rw, app_ro', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION catalog.is_active_partner_manager(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.is_active_partner_manager(uuid, text) TO app_rw, app_ro;

COMMIT;
