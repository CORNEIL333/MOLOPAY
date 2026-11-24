-- Migration 0075 — inscription en agence (C13, F-ACC-001, décision du
-- fondateur du 24 novembre : « ajoute aussi l'enregistrement en agence »).
-- Dépend de 0004 et 0066 (identity.otp_challenge).
--
-- Sans SMS, un agent vérifie EN PERSONNE l'identité et le téléphone du client,
-- puis émet un code d'inscription ordinaire (même table, mêmes règles : 5 min,
-- 5 essais, 5 codes par numéro et par heure) qu'il remet au client ; le client
-- termine l'inscription sur son appareil par la route habituelle. Chaque code
-- émis en agence est rattaché ici, en ajout seul, à l'agent, à la ville et au
-- type de pièce présentée (jamais son numéro : minimisation, REG-DPD-003).
-- Au plus 30 codes par agent sur 24 heures (abus d'un agent ; valeur D91).

BEGIN;

CREATE TABLE identity.agency_enrollment (
  challenge_id uuid PRIMARY KEY REFERENCES identity.otp_challenge (id),
  staff_id text NOT NULL CHECK (length(staff_id) BETWEEN 1 AND 200 AND staff_id !~ '[[:space:]]'),
  city_id text NOT NULL CHECK (city_id IN ('yaounde', 'douala')),
  document_type text NOT NULL CHECK (document_type IN ('CNI', 'PASSPORT', 'RESIDENCE_PERMIT')),
  issued_at timestamptz NOT NULL
);

CREATE FUNCTION identity.anchor_agency_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.agency-enrollment:' || NEW.staff_id, 0));
  -- Le code rattaché est un code d'inscription neuf, émis dans la même minute et encore inutilisé.
  IF NOT EXISTS (
    SELECT 1 FROM identity.otp_challenge c
     WHERE c.id = NEW.challenge_id AND c.purpose = 'SIGNUP' AND c.consumed_at IS NULL
       AND c.created_at >= clock_timestamp() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'IDENTITY_INVALID_REQUEST: code d''inscription inconnu, utilisé ou ancien';
  END IF;
  IF (SELECT count(*) FROM identity.agency_enrollment e
       WHERE e.staff_id = NEW.staff_id AND e.issued_at >= clock_timestamp() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'REQUEST_RATE_LIMITED: trop d''inscriptions en agence pour cet agent sur 24 heures';
  END IF;
  NEW.issued_at := clock_timestamp();
  RETURN NEW;
END $fn$;

CREATE FUNCTION identity.forbid_agency_enrollment_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'IDENTITY_APPEND_ONLY: % sur % refusé', TG_OP, TG_TABLE_NAME;
END $fn$;

CREATE TRIGGER agency_enrollment_anchor BEFORE INSERT ON identity.agency_enrollment
  FOR EACH ROW EXECUTE FUNCTION identity.anchor_agency_enrollment();
CREATE TRIGGER agency_enrollment_no_update_delete BEFORE UPDATE OR DELETE ON identity.agency_enrollment
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_agency_enrollment_mutation();
CREATE TRIGGER agency_enrollment_no_truncate BEFORE TRUNCATE ON identity.agency_enrollment
  FOR EACH STATEMENT EXECUTE FUNCTION identity.forbid_agency_enrollment_mutation();
ALTER TABLE identity.agency_enrollment ENABLE ALWAYS TRIGGER agency_enrollment_anchor;
ALTER TABLE identity.agency_enrollment ENABLE ALWAYS TRIGGER agency_enrollment_no_update_delete;
ALTER TABLE identity.agency_enrollment ENABLE ALWAYS TRIGGER agency_enrollment_no_truncate;

REVOKE ALL ON FUNCTION identity.anchor_agency_enrollment() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.forbid_agency_enrollment_mutation() FROM PUBLIC;
GRANT SELECT, INSERT ON identity.agency_enrollment TO app_rw;
GRANT SELECT ON identity.agency_enrollment TO app_ro;
REVOKE UPDATE, DELETE, TRUNCATE ON identity.agency_enrollment FROM app_rw, app_ro;

COMMIT;
