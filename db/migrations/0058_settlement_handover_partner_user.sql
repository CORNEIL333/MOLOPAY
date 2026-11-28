-- Migration 0058 — remise au comptoir : le vendeur est un compte partenaire
-- actif du marchand (lot 20 : F-SET-001, SEC-AUTH-006, F-PRT-003, D63).
-- Dépend de 0040 (settlement.handover) et 0057 (catalog.partner_user).
--
-- Jusqu'ici `partner_user_id` était un texte libre fourni par l'appelant.
-- La base exige désormais l'identifiant d'un compte nominatif (gérant ou
-- vendeur) du même partenaire, non désactivé. Restrictif seulement : aucune
-- remise existante n'est modifiée (aucune n'existe hors données de test).

BEGIN;

CREATE FUNCTION settlement.assert_handover_partner_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.partner_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NOT EXISTS (
       SELECT 1 FROM catalog.partner_user u
        WHERE u.id = NEW.partner_user_id::uuid AND u.partner_id = NEW.partner_id
          AND NOT EXISTS (SELECT 1 FROM catalog.partner_user_disable x WHERE x.user_id = u.id)
     ) THEN
    RAISE EXCEPTION 'PARTNER_ROLE_DENIED: remise par un compte actif du partenaire uniquement';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION settlement.assert_handover_partner_user() FROM PUBLIC;
CREATE TRIGGER handover_partner_user BEFORE INSERT ON settlement.handover
  FOR EACH ROW EXECUTE FUNCTION settlement.assert_handover_partner_user();
ALTER TABLE settlement.handover ENABLE ALWAYS TRIGGER handover_partner_user;

COMMIT;
