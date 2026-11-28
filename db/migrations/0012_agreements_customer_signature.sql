-- Migration 0012 — signature d'appareil exigée pour l'annulation client.
-- SEC-AUTH-002 : toute annulation exige une signature de transaction par la
-- clé de l'appareil ; INT-NR-001 : l'acceptation d'un accord est signée.
-- 0011 n'exigeait la signature qu'à l'activation. La contrainte est
-- remplacée par une version plus stricte ; aucune ligne n'est modifiée.

BEGIN;

ALTER TABLE agreements.status_event
  DROP CONSTRAINT IF EXISTS status_event_activation_signed;

ALTER TABLE agreements.status_event
  ADD CONSTRAINT status_event_customer_signed CHECK (
    (kind = 'TRANSITION'
      AND ((from_status = 'DRAFT' AND to_status = 'ACTIVE')
        OR (from_status = 'ACTIVE' AND to_status = 'CANCELLED_BY_CUSTOMER'))
      AND device_id IS NOT NULL AND signature IS NOT NULL)
    OR (NOT (kind = 'TRANSITION'
      AND ((from_status = 'DRAFT' AND to_status = 'ACTIVE')
        OR (from_status = 'ACTIVE' AND to_status = 'CANCELLED_BY_CUSTOMER')))
      AND device_id IS NULL AND signature IS NULL)
  );

COMMIT;
