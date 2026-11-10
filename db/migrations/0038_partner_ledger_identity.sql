-- Migration 0038 — identifiant comptable des partenaires (D42, INT-LED-006).
-- Dépend de 0008 (catalog.partner_validation).
--
-- ledger.account identifie le propriétaire d'un compte 2200 par un UUID ;
-- les partenaires ont un identifiant texte. À la PREMIÈRE validation d'un
-- partenaire (maker-checker), la base lui attribue un UUID v7 immuable, en
-- ajout seul, jamais réattribué. Personne ne l'attribue à la main : seul le
-- déclencheur de validation l'écrit (fonction SECURITY DEFINER).

BEGIN;

CREATE TABLE catalog.partner_ledger_identity (
  partner_id text PRIMARY KEY CHECK (partner_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  owner_id uuid NOT NULL UNIQUE,
  assigned_at timestamptz NOT NULL,
  CONSTRAINT partner_ledger_identity_v7 CHECK (
    substring(owner_id::text FROM 15 FOR 1) = '7'
    AND substring(owner_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
  )
);

-- UUID v7 : 48 bits d'horodatage en millisecondes, puis aléa (RFC 9562).
CREATE FUNCTION catalog.new_uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid
$$;

CREATE FUNCTION catalog.assign_partner_ledger_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO catalog.partner_ledger_identity (partner_id, owner_id, assigned_at)
  VALUES (NEW.partner_id, catalog.new_uuid_v7(), clock_timestamp())
  ON CONFLICT (partner_id) DO NOTHING;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION catalog.new_uuid_v7() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.assign_partner_ledger_identity() FROM PUBLIC;

CREATE TRIGGER partner_validation_ledger_identity
  AFTER INSERT ON catalog.partner_validation
  FOR EACH ROW EXECUTE FUNCTION catalog.assign_partner_ledger_identity();
ALTER TABLE catalog.partner_validation ENABLE ALWAYS TRIGGER partner_validation_ledger_identity;

CREATE TRIGGER partner_ledger_identity_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog.partner_ledger_identity
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER partner_ledger_identity_no_truncate
  BEFORE TRUNCATE ON catalog.partner_ledger_identity
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
ALTER TABLE catalog.partner_ledger_identity ENABLE ALWAYS TRIGGER partner_ledger_identity_no_update_delete;
ALTER TABLE catalog.partner_ledger_identity ENABLE ALWAYS TRIGGER partner_ledger_identity_no_truncate;

-- Partenaires déjà validés avant cette migration.
INSERT INTO catalog.partner_ledger_identity (partner_id, owner_id, assigned_at)
SELECT DISTINCT ON (v.partner_id) v.partner_id, catalog.new_uuid_v7(), clock_timestamp()
FROM catalog.partner_validation v
ORDER BY v.partner_id
ON CONFLICT (partner_id) DO NOTHING;

GRANT SELECT ON catalog.partner_ledger_identity TO app_rw, app_ro;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON catalog.partner_ledger_identity FROM app_rw, app_ro;

COMMIT;
