import { describe, expect, it } from 'vitest';
import { assertSecureDatabaseUrl, databaseConfigFromEnv } from './database';

/**
 * N2 (ADR-0004, SEC-CRY-001) : vers Neon (ou toute base distante), la
 * connexion est chiffrée ET le certificat du serveur vérifié, nom d'hôte
 * compris (`sslmode=verify-full`). En production, aucune exception, même pour
 * un hôte local. Hors production, une base locale de développement reste
 * permise sans TLS.
 */
const NEON = 'postgresql://molopay_api@ep-exemple-123456.eu-central-1.aws.neon.tech/molopay';

describe('N2 — TLS vérifié obligatoire vers la base', () => {
  it('accepte une base distante en verify-full, en production comme ailleurs', () => {
    for (const env of [{ NODE_ENV: 'production' }, {}]) {
      expect(() => assertSecureDatabaseUrl(`${NEON}?sslmode=verify-full`, env)).not.toThrow();
      expect(() => assertSecureDatabaseUrl(`${NEON}?channel_binding=require&sslmode=verify-full`, env)).not.toThrow();
    }
  });

  it('refuse : base distante sans TLS vérifié (absent, disable, prefer, require, verify-ca) → DATABASE_TLS_REQUIRED', () => {
    for (const suffix of ['', '?sslmode=disable', '?sslmode=prefer', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full&sslmode=disable', '?ssl=false']) {
      expect(() => assertSecureDatabaseUrl(`${NEON}${suffix}`, {}), suffix).toThrow(/^DATABASE_TLS_REQUIRED/);
    }
  });

  it('refuse : réglages qui changeraient la vérification (autorité substituée, compatibilité libpq, certificats acceptés)', () => {
    // node-postgres vérifie avec les autorités du système en verify-full ; tout réglage TLS supplémentaire est refusé.
    for (const suffix of ['&sslaccept=accept_invalid_certs', '&sslrootcert=/tmp/ca.pem', '&sslrootcert=system', '&rejectUnauthorized=false', '&uselibpqcompat=true', '&sslcert=/tmp/c.pem', '&sslkey=/tmp/k.pem']) {
      expect(() => assertSecureDatabaseUrl(`${NEON}?sslmode=verify-full${suffix}`, {}), suffix).toThrow(/^DATABASE_TLS_REQUIRED/);
    }
  });

  it('base locale : permise sans TLS hors production, refusée sans TLS en production', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(() => assertSecureDatabaseUrl(`postgres://molopay@${host}:5432/molopay_test`, {}), host).not.toThrow();
      expect(() => assertSecureDatabaseUrl(`postgres://molopay@${host}:5432/molopay`, { NODE_ENV: 'production' }), host).toThrow(/^DATABASE_TLS_REQUIRED/);
    }
  });

  it('refuse : adresse illisible ou d’un autre protocole (DATABASE_URL_INVALID), sans recopier l’adresse', () => {
    for (const raw of ['pas une url', 'mysql://u@h/db', 'http://h/db']) {
      expect(() => assertSecureDatabaseUrl(raw, {})).toThrow(/^DATABASE_URL_INVALID/);
    }
    try {
      assertSecureDatabaseUrl('postgresql://u:secret-value@ep-x.neon.tech/db', {});
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
      expect(String(error)).not.toContain('ep-x.neon.tech');
    }
  });

  it('l’API applique la règle au démarrage (databaseConfigFromEnv)', () => {
    expect(() => databaseConfigFromEnv({ DATABASE_URL: NEON, NODE_ENV: 'production' })).toThrow(/^DATABASE_TLS_REQUIRED/);
    expect(databaseConfigFromEnv({ DATABASE_URL: `${NEON}?sslmode=verify-full`, NODE_ENV: 'production', DATABASE_ROLE: 'app_rw' })).toMatchObject({ role: 'app_rw' });
  });
});
