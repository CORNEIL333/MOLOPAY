import { describe, expect, it, vi } from 'vitest';
import { assertDirectEndpoint, assertSecureDatabaseUrl, connectionErrorCode, databaseConfigFromEnv, reportConnectionLost } from './database';

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

describe('Neon — point d’accès direct et réglages du pool', () => {
  it('point d’accès groupé (-pooler) refusé pour les outils à session (DATABASE_POOLER_FORBIDDEN), direct accepté', () => {
    expect(() => assertDirectEndpoint('postgresql://u@ep-exemple-123456-pooler.eu-central-1.aws.neon.tech/db?sslmode=verify-full')).toThrow(/^DATABASE_POOLER_FORBIDDEN/);
    expect(() => assertDirectEndpoint('postgresql://u@ep-exemple-123456.eu-central-1.aws.neon.tech/db?sslmode=verify-full')).not.toThrow();
    expect(() => assertDirectEndpoint('postgres://u@127.0.0.1:5432/db')).not.toThrow();
  });

  it('pool : 10 connexions et 15 s par requête par défaut ; bornes 1–50 et 1–120 s', () => {
    expect(databaseConfigFromEnv({ DATABASE_URL: 'postgres://u@127.0.0.1/db' })).toMatchObject({ poolMax: 10, statementTimeoutMs: 15_000 });
    expect(databaseConfigFromEnv({ DATABASE_URL: 'postgres://u@127.0.0.1/db', DATABASE_POOL_MAX: '25', DATABASE_STATEMENT_TIMEOUT_MS: '5000' })).toMatchObject({ poolMax: 25, statementTimeoutMs: 5000 });
    for (const env of [{ DATABASE_POOL_MAX: '0' }, { DATABASE_POOL_MAX: '51' }, { DATABASE_POOL_MAX: '2.5' }, { DATABASE_STATEMENT_TIMEOUT_MS: '999' }, { DATABASE_STATEMENT_TIMEOUT_MS: '120001' }, { DATABASE_STATEMENT_TIMEOUT_MS: 'beaucoup' }]) {
      expect(() => databaseConfigFromEnv({ DATABASE_URL: 'postgres://u@127.0.0.1/db', ...env }), JSON.stringify(env)).toThrow(/^CONFIG_INVALID: DATABASE_/);
    }
  });
});


describe('N8 — coupure de connexion signalée par son code seul', () => {
  it('code PostgreSQL ou système repris ; tout le reste réduit à CONNECTION_LOST, jamais le message', () => {
    expect(connectionErrorCode({ code: '57P01', message: 'terminating connection due to administrator command' })).toBe('57P01');
    expect(connectionErrorCode({ code: 'ECONNRESET', message: 'read ECONNRESET 10.0.0.5:5432' })).toBe('ECONNRESET');
    for (const value of [new Error('Connection terminated unexpectedly ep-x.neon.tech'), { code: 'motdepasse@hote' }, { code: 57 }, null, 'texte', { code: 'E' }]) {
      expect(connectionErrorCode(value)).toBe('CONNECTION_LOST');
    }
  });

  it('signalement par défaut : une ligne JSON sur la sortie d’erreur, avec le code seul', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      reportConnectionLost('57P01');
      expect(spy.mock.calls).toEqual([['{"event":"DATABASE_CONNECTION_LOST","code":"57P01"}\n']]);
    } finally {
      spy.mockRestore();
    }
  });
});
