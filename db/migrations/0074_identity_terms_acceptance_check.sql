-- Migration 0074 — conditions en vigueur acceptées avant tout nouvel
-- engagement (F-ACC-004). Dépend de 0066 (identity.terms_acceptance).
--
-- Seule voie de lecture pour les autres modules : un booléen, pour un compte
-- et une version donnés. L'acceptation reste en ajout seul, horodatée par la
-- base (0066) ; un compte bloqué ou fermé n'a pas de conditions « acceptées ».

BEGIN;

CREATE FUNCTION identity.has_accepted_terms(p_account uuid, p_version text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM identity.terms_acceptance t
      JOIN identity.account a ON a.id = t.account_id
     WHERE t.account_id = p_account AND t.version = p_version AND a.status = 'ACTIVE'
  )
$fn$;

REVOKE ALL ON FUNCTION identity.has_accepted_terms(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.has_accepted_terms(uuid, text) TO app_rw, app_ro;

COMMIT;
