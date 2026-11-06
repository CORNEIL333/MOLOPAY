-- F-CAT-001/004 : présentation liée à une version, sans titre historique inventé.
BEGIN;
CREATE TABLE catalog.offer_presentation (
  offer_id uuid NOT NULL,
  version integer NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND title = btrim(title) AND title !~ '^[[:space:]]*$'),
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200 AND created_by !~ '[[:space:]]'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (offer_id, version),
  FOREIGN KEY (offer_id, version) REFERENCES catalog.offer_version (offer_id, version)
);
CREATE TRIGGER presentation_anchor BEFORE INSERT ON catalog.offer_presentation
  FOR EACH ROW EXECUTE FUNCTION catalog.anchor_offer();
CREATE TRIGGER presentation_no_mutation BEFORE UPDATE OR DELETE ON catalog.offer_presentation
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_mutation();
CREATE TRIGGER presentation_no_truncate BEFORE TRUNCATE ON catalog.offer_presentation
  FOR EACH STATEMENT EXECUTE FUNCTION catalog.forbid_mutation();
ALTER TABLE catalog.offer_presentation ENABLE ALWAYS TRIGGER presentation_anchor;
ALTER TABLE catalog.offer_presentation ENABLE ALWAYS TRIGGER presentation_no_mutation;
ALTER TABLE catalog.offer_presentation ENABLE ALWAYS TRIGGER presentation_no_truncate;
CREATE VIEW catalog.public_offer WITH (security_invoker = true) AS
SELECT o.offer_id, o.version, o.partner_id, d.legal_name AS partner_name, p.title,
  o.universe, o.models, o.city_ids, o.price_xaf, o.availability_kind, o.stock_units,
  o.lead_days, o.warranty, o.discount_terms, o.state
FROM catalog.offer_current o
JOIN catalog.offer_presentation p ON p.offer_id = o.offer_id AND p.version = o.version
JOIN catalog.partner_state s ON s.partner_id = o.partner_id
JOIN catalog.partner_dossier d ON d.partner_id = s.partner_id AND d.version = s.dossier_version
WHERE o.state = 'PUBLISHED' AND s.status = 'VALIDATED' AND NOT o.partner_in_default;
REVOKE ALL ON TABLE catalog.offer_presentation, catalog.public_offer FROM PUBLIC;
GRANT SELECT, INSERT ON catalog.offer_presentation TO app_rw;
GRANT SELECT ON catalog.offer_presentation, catalog.public_offer TO app_ro;
GRANT SELECT ON catalog.public_offer TO app_rw;
COMMIT;
