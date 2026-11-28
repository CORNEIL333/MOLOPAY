-- Migration 0069 — fil des notifications du client dans l'application
-- (C5, F-NOT-001). Dépend de 0019 (notifications.outbox) et 0023
-- (identity.lock_security_actor).
--
-- Le rôle applicatif ne lit pas la boîte d'envoi directement : cette
-- fonction, seule voie, revérifie la session en base (compte, appareil,
-- session actifs, comme `identity.list_data_rights`) et ne renvoie que les
-- événements du client, un par événement (SMS et push regroupés), du plus
-- récent au plus ancien, par pages (51e ligne interne pour savoir s'il y a
-- une suite). Aucun contenu libre : type d'événement, langue et date.

BEGIN;

CREATE FUNCTION notifications.list_customer_feed(p_account uuid, p_device uuid, p_session uuid, p_before uuid)
RETURNS TABLE (notification_id uuid, event_type text, locale text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  cursor_time timestamptz;
BEGIN
  PERFORM identity.lock_security_actor(p_account, p_device, p_session);
  IF p_before IS NOT NULL THEN
    SELECT min(o.created_at) INTO cursor_time FROM notifications.outbox o WHERE o.recipient_id = p_account AND o.event_key = p_before;
    IF cursor_time IS NULL THEN
      RAISE EXCEPTION 'REQUEST_INVALID: curseur invalide';
    END IF;
  END IF;
  RETURN QUERY
    SELECT e.event_key, e.event_type, e.locale, e.created_at
      FROM (
        SELECT o.event_key, min(o.event_type) AS event_type, min(o.locale) AS locale, min(o.created_at) AS created_at
          FROM notifications.outbox o
         WHERE o.recipient_id = p_account
         GROUP BY o.event_key
      ) e
     WHERE p_before IS NULL OR (e.created_at, e.event_key) < (cursor_time, p_before)
     ORDER BY e.created_at DESC, e.event_key DESC
     LIMIT 51;
END $fn$;

REVOKE ALL ON FUNCTION notifications.list_customer_feed(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notifications.list_customer_feed(uuid, uuid, uuid, uuid) TO app_rw;

COMMIT;
