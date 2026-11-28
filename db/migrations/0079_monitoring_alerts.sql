-- Migration 0079 — alertes de supervision calculées en base (NF-OBS-003).
-- Dépend de 0019–0021, 0026, 0030, 0050, 0070, 0072, 0078.
--
-- Une seule fonction, en lecture, qui ne renvoie que des compteurs (aucun
-- identifiant ni donnée de client), accordée au seul rôle de supervision
-- (`notification_observer`, compte `molopay_monitor`). L'instant d'évaluation
-- est un paramètre (par défaut : maintenant) pour rendre le calcul vérifiable.
-- Idempotente : les suites de tests recréent les autres schémas sans celui-ci.

BEGIN;

CREATE SCHEMA IF NOT EXISTS monitoring;
REVOKE ALL ON SCHEMA monitoring FROM PUBLIC;

CREATE OR REPLACE FUNCTION monitoring.alert_counts(p_at timestamptz DEFAULT clock_timestamp())
RETURNS TABLE (payments_pending_over_15_min integer, reconciliation_unclassified integer, notifications_exhausted integer,
               integrity_divergence_open boolean, outgoing_frozen boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT
    -- Tentatives dont le dernier état est PENDING depuis plus de 15 minutes.
    (SELECT count(*)::int FROM payments.attempt_event e
      WHERE e.to_status = 'PENDING' AND e.created_at <= p_at - interval '15 minutes'
        AND e.seq = (SELECT max(x.seq) FROM payments.attempt_event x WHERE x.attempt_id = e.attempt_id)),
    -- Écarts ouverts sans classement approuvé.
    (SELECT count(*)::int FROM reconciliation.incident i
      WHERE i.classification IS NULL
        AND NOT EXISTS (SELECT 1 FROM reconciliation.classification_proposal p
                          JOIN reconciliation.classification_decision d ON d.proposal_id = p.id
                         WHERE p.incident_id = i.id AND d.decision = 'APPROVED')),
    -- Notifications ayant épuisé leurs tentatives, sans bail ni confirmation d'envoi.
    (SELECT count(*)::int FROM notifications.dispatch_state s
      WHERE s.attempt >= s.attempt_limit AND s.claim_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM notifications.delivery d
                         WHERE d.recipient_id = s.recipient_id AND d.event_key = s.event_key AND d.channel = s.channel)),
    -- Divergence d'intégrité non levée depuis la dernière levée du gel confirmée.
    EXISTS (SELECT 1 FROM settlement.integrity_divergence v
             WHERE v.detected_at > COALESCE((SELECT max(c.confirmed_at) FROM settlement.outgoing_freeze_confirmation c
                                               JOIN settlement.outgoing_freeze_request r ON r.id = c.request_id
                                              WHERE r.action = 'UNFREEZE'), '-infinity'::timestamptz)),
    settlement.outgoing_frozen();
END $$;

REVOKE ALL ON FUNCTION monitoring.alert_counts(timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_observer') THEN
    GRANT USAGE ON SCHEMA monitoring TO notification_observer;
    GRANT EXECUTE ON FUNCTION monitoring.alert_counts(timestamptz) TO notification_observer;
  END IF;
END $$;

COMMIT;
