-- Migration 0065 — corrections de la revue indépendante du 19 novembre
-- (IMP-1, IMP-2 ; REG-LBC-001, REG-LBC-002, D66, D68). Dépend de 0059, 0060, 0063.
--
-- IMP-1 : le rôle applicatif `app_rw` pouvait importer une version de liste
-- « officielle » quelconque (préfixe d'URL seul vérifié), qui devenait la
-- référence du recalcul en base : tout nom listé sortait alors « sans
-- rapprochement ». L'import est désormais réservé au rôle `kyc_list_importer`
-- (sans connexion, à attribuer à un opérateur distinct du compte de
-- l'application) ; `app_rw` garde la lecture.
--
-- IMP-2 : la normalisation SQL ne retire que certaines marques diacritiques ;
-- une autre marque (ex. U+0951) coupait un mot côté base mais pas côté
-- application. Un nom déclaré ne contient plus, après décomposition et retrait
-- de ces marques, que lettres, chiffres et séparateurs admis (liste blanche,
-- identique à `parseLegalName`) : sur tout nom accepté, les deux
-- normalisations coïncident (prouvé par test sur plusieurs écritures).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kyc_list_importer') THEN
    CREATE ROLE kyc_list_importer NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA kyc TO kyc_list_importer;
REVOKE INSERT ON kyc.sanctions_list_version, kyc.sanctions_entry FROM app_rw;
GRANT SELECT, INSERT ON kyc.sanctions_list_version, kyc.sanctions_entry TO kyc_list_importer;
REVOKE UPDATE, DELETE, TRUNCATE ON kyc.sanctions_list_version, kyc.sanctions_entry FROM kyc_list_importer;

-- Nom admissible : après NFKD et retrait des marques normalisées, seulement
-- lettres, chiffres, espace, apostrophes, point, virgule et tiret.
CREATE FUNCTION kyc.legal_name_admissible(p_name text) RETURNS boolean
LANGUAGE sql STABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT regexp_replace(normalize(p_name, NFKD), '[̀-ͯ҃-҉᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g') COLLATE "und-x-icu" !~ '[^[:alnum:] ''’ʼ.,-]'
$fn$;
REVOKE ALL ON FUNCTION kyc.legal_name_admissible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyc.legal_name_admissible(text) TO app_rw, app_ro;

-- Ancrage de la déclaration : règles de 0063, plus la liste blanche IMP-2.
CREATE OR REPLACE FUNCTION identity.anchor_legal_name_declaration() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF (SELECT status FROM identity.account WHERE id = NEW.account_id) IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte bloqué ou inconnu';
  END IF;
  IF NEW.legal_name ~ '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￸\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]' OR NEW.legal_name ~ '[؀-؅۝܏࢐࢑࣢￹-￻\U000110BD\U000110CD\U00013430-\U0001343F]' THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: caractère invisible ou de format dans le nom déclaré';
  END IF;
  IF NOT kyc.legal_name_admissible(NEW.legal_name) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: caractère hors des lettres, chiffres et séparateurs admis';
  END IF;
  NEW.declared_at := clock_timestamp();
  RETURN NEW;
END $fn$;

COMMIT;
