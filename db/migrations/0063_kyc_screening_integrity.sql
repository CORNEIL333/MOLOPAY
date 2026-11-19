-- Migration 0063 — intégrité du filtrage ONU garantie par la base (I-2, I-5,
-- revue indépendante du 19 novembre ; REG-LBC-001, REG-LBC-002, D66, D68).
-- Dépend de 0059 (kyc) et 0060 (déclaration du nom légal).
--
-- Jusqu'ici la base croyait l'application sur le contenu d'un filtrage : un
-- filtrage « sans rapprochement » forgé pour un nom listé, rattaché à la
-- déclaration, débloquait le niveau 1. Désormais :
--   * la base recalcule les références rapprochées (même règle que
--     `name-match.ts`) et refuse tout écart ; le filtrage doit utiliser la
--     version de liste la plus récente ;
--   * un filtrage ne se rattache à une déclaration que s'il porte le nom
--     déclaré (normalisation SQL identique à la normalisation applicative,
--     prouvée par test sur les écritures latine, cyrillique et grecque) ;
--   * une déclaration contenant un caractère invisible ou de format est
--     refusée (I-1) ;
--   * une version de liste vient de l'hôte officiel ONU et n'est pas datée
--     du futur (elle deviendrait la référence).
-- Exige la collation ICU « und-x-icu » (majuscules Unicode indépendantes de
-- la locale de la grappe) : sans ICU, la migration échoue (refus visible).

BEGIN;

-- Forme de comparaison d'un nom : identique à `normalizeName` (name-match.ts).
CREATE FUNCTION kyc.normalize_name(p_name text) RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT btrim(regexp_replace(
    translate(
      upper(regexp_replace(normalize(regexp_replace(p_name, '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￸\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]', '', 'g'), NFKD), '[̀-ͯ҃-҉᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g') COLLATE "und-x-icu"),
      'АВЕЅІЈКМНОРСТХУҮӀԚԜΑΒΕΖΗΙΚΜΝΟΡΤΥΧ', 'ABESIJKMHOPCTXYYIQWABEZHIKMNOPTYX'),
    '[^[:alnum:]]+', ' ', 'g') COLLATE "und-x-icu")
$fn$;

-- Mots distincts d'un nom normalisé.
CREATE FUNCTION kyc.name_tokens(p_name text) RETURNS text[]
LANGUAGE sql STABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT coalesce(array_agg(DISTINCT t), '{}') FROM unnest(string_to_array(kyc.normalize_name(p_name), ' ')) AS t WHERE t <> ''
$fn$;

-- Références de la version dont un nom (tel quel, sans parenthèses, ou le
-- contenu d'une parenthèse) se rapproche : mêmes mots, ou inclusion dès que
-- le plus petit ensemble compte au moins deux mots (règle de name-match.ts).
CREATE FUNCTION kyc.matching_references(p_name text, p_version uuid) RETURNS text[]
LANGUAGE sql STABLE STRICT SET search_path = pg_catalog, pg_temp AS $fn$
  WITH subject AS (SELECT kyc.name_tokens(p_name) AS s)
  SELECT coalesce(array_agg(DISTINCT e.reference), '{}')
    FROM kyc.sanctions_entry e, subject
   WHERE e.version_id = p_version
     AND EXISTS (
       SELECT 1
         FROM unnest(e.names) AS n(name)
        CROSS JOIN LATERAL (
          SELECT n.name AS v
          UNION ALL SELECT regexp_replace(n.name, '\([^()]*\)', ' ', 'g')
          UNION ALL SELECT m[1] FROM regexp_matches(n.name, '\(([^()]*)\)', 'g') AS m
        ) AS variant
        CROSS JOIN LATERAL (SELECT kyc.name_tokens(variant.v) AS l) AS listed
        WHERE cardinality(listed.l) > 0
          AND ((listed.l @> subject.s AND subject.s @> listed.l)
               OR (least(cardinality(listed.l), cardinality(subject.s)) >= 2 AND (subject.s @> listed.l OR listed.l @> subject.s))))
$fn$;

REVOKE ALL ON FUNCTION kyc.normalize_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kyc.name_tokens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION kyc.matching_references(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyc.normalize_name(text) TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION kyc.name_tokens(text) TO app_rw, app_ro;
GRANT EXECUTE ON FUNCTION kyc.matching_references(text, uuid) TO app_rw, app_ro;

-- I-2 : après les contraintes de ligne, la base vérifie la version et recalcule les rapprochements.
CREATE FUNCTION kyc.verify_screening() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  latest uuid;
  expected text[];
BEGIN
  SELECT v.id INTO latest FROM kyc.sanctions_list_version v ORDER BY v.generated_at DESC, v.imported_at DESC, v.id DESC LIMIT 1;
  IF latest IS DISTINCT FROM NEW.version_id THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: version de liste qui n''est pas la plus récente';
  END IF;
  IF NEW.normalized_name IS DISTINCT FROM kyc.normalize_name(NEW.normalized_name) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: nom filtré non normalisé';
  END IF;
  expected := kyc.matching_references(NEW.normalized_name, NEW.version_id);
  IF NOT (expected @> NEW.matched_references AND NEW.matched_references @> expected
          AND cardinality(NEW.matched_references) = cardinality(expected)) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: références rapprochées différentes du recalcul en base';
  END IF;
  RETURN NULL;
END $fn$;

CREATE TRIGGER screening_verified AFTER INSERT ON kyc.screening
  FOR EACH ROW EXECUTE FUNCTION kyc.verify_screening();
ALTER TABLE kyc.screening ENABLE ALWAYS TRIGGER screening_verified;
REVOKE ALL ON FUNCTION kyc.verify_screening() FROM PUBLIC;

-- I-2 : le filtrage rattaché porte le nom déclaré.
CREATE OR REPLACE FUNCTION kyc.anchor_legal_name_screening() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM kyc.screening s JOIN identity.legal_name_declaration d ON d.id = NEW.declaration_id
     WHERE s.id = NEW.screening_id AND s.subject_type = 'CUSTOMER' AND s.subject_id = d.account_id::text AND s.screened_at >= d.declared_at
  ) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: filtrage d''un autre client ou antérieur à la déclaration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM kyc.screening s JOIN identity.legal_name_declaration d ON d.id = NEW.declaration_id
     WHERE s.id = NEW.screening_id AND s.normalized_name = kyc.normalize_name(d.legal_name)
  ) THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: le filtrage ne porte pas sur le nom déclaré';
  END IF;
  RETURN NEW;
END $fn$;

-- I-1 : aucun caractère invisible ou de format dans un nom déclaré.
CREATE OR REPLACE FUNCTION identity.anchor_legal_name_declaration() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF (SELECT status FROM identity.account WHERE id = NEW.account_id) IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'IDENTITY_ACCOUNT_BLOCKED: compte bloqué ou inconnu';
  END IF;
  IF NEW.legal_name ~ '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￸\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]' OR NEW.legal_name ~ '[؀-؅۝܏࢐࢑࣢￹-￻\U000110BD\U000110CD\U00013430-\U0001343F]' THEN
    RAISE EXCEPTION 'KYC_INVALID_REQUEST: caractère invisible ou de format dans le nom déclaré';
  END IF;
  NEW.declared_at := clock_timestamp();
  RETURN NEW;
END $fn$;

-- I-5 : source officielle seulement, jamais datée du futur.
CREATE OR REPLACE FUNCTION kyc.anchor_sanctions_list_version() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.source_url !~ '^https://scsanctions\.un\.org/' THEN
    RAISE EXCEPTION 'KYC_LIST_INVALID: source hors de l''hôte officiel scsanctions.un.org';
  END IF;
  NEW.imported_at := clock_timestamp();
  IF NEW.generated_at > NEW.imported_at THEN
    RAISE EXCEPTION 'KYC_LIST_INVALID: date de génération dans le futur';
  END IF;
  RETURN NEW;
END $fn$;

COMMIT;
