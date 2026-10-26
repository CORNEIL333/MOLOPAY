-- 0002 est déjà appliquée : on remplace la fonction sans réécrire l'historique.
-- La normalisation (minuscules, sans séparateurs) transforme « client_pin » en
-- « clientpin » ; la liste de 0002 ne couvrait pas ces compositions, ni les
-- empreintes (pin_hash, code_hash, token_hash). La liste reste en miroir de
-- FORBIDDEN_METADATA_KEYS dans apps/api/src/modules/audit/domain.ts.
BEGIN;

CREATE OR REPLACE FUNCTION audit.assert_safe_refs(metadata jsonb, depth integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  entry record;
  normalized text;
BEGIN
  IF depth > 8 THEN
    RAISE EXCEPTION 'AUDIT_INVALID_EVENT: métadonnées trop profondes';
  END IF;
  IF jsonb_typeof(metadata) = 'object' THEN
    FOR entry IN SELECT key, value FROM jsonb_each(metadata) LOOP
      IF entry.key !~ '^[A-Za-z0-9_.-]+$' THEN
        RAISE EXCEPTION 'AUDIT_INVALID_EVENT: clé % invalide', entry.key;
      END IF;
      normalized := regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g');
      IF normalized IN (
        'password', 'passwordhash', 'passwd', 'passwordconfirmation',
        'newpassword', 'oldpassword', 'currentpassword',
        'pin', 'pinnumber', 'pincode', 'clientpin', 'newpin', 'oldpin',
        'pinhash',
        'otp', 'otpcode', 'smscode', 'verificationcode',
        'otphash', 'codehash', 'recoverycode', 'backupcode', 'otpmac',
        'token', 'accesstoken', 'refreshtoken', 'authtoken', 'bearertoken',
        'sessiontoken', 'tokenhash',
        'secret', 'clientsecret', 'secretkey', 'privatekey', 'apikey',
        'mackey', 'pepper',
        'authorization', 'cookie', 'cvv', 'cvv2', 'cvvcode', 'securitycode',
        'pan', 'cardnumber', 'iban', 'accountnumber', 'documentnumber',
        'idnumber', 'nationalid', 'msisdn'
      ) THEN
        RAISE EXCEPTION 'AUDIT_SENSITIVE_METADATA: clé % interdite', entry.key;
      END IF;
      PERFORM audit.assert_safe_refs(entry.value, depth + 1);
    END LOOP;
  ELSIF jsonb_typeof(metadata) = 'array' THEN
    FOR entry IN SELECT item FROM jsonb_array_elements(metadata) AS item LOOP
      PERFORM audit.assert_safe_refs(entry.item, depth + 1);
    END LOOP;
  END IF;
END $$;

REVOKE ALL ON FUNCTION audit.assert_safe_refs(jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.assert_safe_refs(jsonb, integer) TO app_rw;

COMMIT;
