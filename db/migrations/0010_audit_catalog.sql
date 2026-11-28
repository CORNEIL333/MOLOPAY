-- Migration 0010 — ajoute CATALOG_ACTION au vocabulaire d'audit (F-CAT-002 :
-- toute tentative de plan non approuvé est refusée et journalisée).
-- Même méthode que 0004 : la contrainte nommée est remplacée par une liste
-- qui reprend toutes les valeurs existantes ; aucune ligne n'est modifiée.

BEGIN;

ALTER TABLE audit.event DROP CONSTRAINT IF EXISTS event_event_type_check;
ALTER TABLE audit.event ADD CONSTRAINT event_event_type_check CHECK (event_type IN (
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'PERMISSION_CHANGED',
  'SENSITIVE_DATA_READ',
  'FINANCIAL_HISTORY_READ',
  'BACKOFFICE_ACTION',
  'CONFIG_CHANGED',
  'EXPORT_CREATED',
  'IDENTITY_ACTION',
  'CATALOG_ACTION'
));

COMMIT;
