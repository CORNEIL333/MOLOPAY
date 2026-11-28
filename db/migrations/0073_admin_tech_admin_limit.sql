-- Migration 0073 — administrateur technique : deux personnes au plus
-- (F-BO-001). Dépend de 0056.
--
-- Les rôles courants d'un membre du personnel sont ceux de sa dernière
-- attribution ; un compte désactivé ne compte plus. Une attribution qui
-- donnerait le rôle TECH_ADMIN à une troisième personne active est refusée
-- par la base, même approuvée par deux administrateurs. Les attributions
-- concurrentes sont sérialisées.

BEGIN;

CREATE FUNCTION admin.assert_tech_admin_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  holders integer;
BEGIN
  IF NOT ('TECH_ADMIN' = ANY (NEW.roles)) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('admin.tech-admin-holders', 0));
  SELECT count(*) INTO holders
    FROM admin.staff_account s
   WHERE s.id <> NEW.staff_id
     AND NOT EXISTS (SELECT 1 FROM admin.staff_disable x WHERE x.staff_id = s.id)
     AND EXISTS (
       SELECT 1 FROM (
         SELECT g.roles FROM admin.staff_role_grant g
          WHERE g.staff_id = s.id ORDER BY g.granted_at DESC, g.id DESC LIMIT 1
       ) AS latest
        WHERE 'TECH_ADMIN' = ANY (latest.roles)
     );
  IF holders >= 2 THEN
    RAISE EXCEPTION 'ADMIN_TECH_ADMIN_LIMIT: deux administrateurs techniques au plus (F-BO-001)';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER staff_role_grant_tech_admin_limit BEFORE INSERT ON admin.staff_role_grant
  FOR EACH ROW EXECUTE FUNCTION admin.assert_tech_admin_limit();
ALTER TABLE admin.staff_role_grant ENABLE ALWAYS TRIGGER staff_role_grant_tech_admin_limit;

REVOKE ALL ON FUNCTION admin.assert_tech_admin_limit() FROM PUBLIC;

COMMIT;
