-- Migration 0035 — valeurs d'exploitation des quotas des routes compte
-- (D38, SEC-API-003). Décidées le 10 novembre 2026 par délégation du
-- fondateur (compte rendu § D38). Dépend de 0025.
--
-- Une politique ne se modifie jamais : chaque action reçoit la version qui
-- suit la dernière existante (version 1 sur une base neuve). Les compteurs
-- d'une version antérieure cessent simplement d'être consultés.

BEGIN;

INSERT INTO identity.customer_quota_policy (action, version, window_seconds, account_limit, device_limit)
SELECT v.action,
       COALESCE((SELECT max(p.version) FROM identity.customer_quota_policy p
                 WHERE p.action = v.action), 0) + 1,
       v.window_seconds, v.account_limit, v.device_limit
FROM (VALUES
  ('SECURITY_READ',      3600, 60, 60),
  ('REVOKE_OTHERS',      3600,  5,  5),
  ('DATA_RIGHTS_READ',   3600, 30, 30),
  ('DATA_RIGHTS_SUBMIT', 86400, 5,  5)
) AS v(action, window_seconds, account_limit, device_limit);

COMMIT;
