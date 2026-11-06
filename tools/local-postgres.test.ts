import { describe, expect, it } from 'vitest';
import { localDatabaseEnvironment, localPostgresOptions } from './local-postgres';

describe('SEC-SDLC-001 PostgreSQL jetable local', () => {
  it('refuse tout mode autre que les suites autorisées', () => {
    expect(() => localPostgresOptions(['production'])).toThrow('LOCAL_DB_MODE_INVALID');
  });
  it('ne reprend ni URL distante ni paramètres de connexion hérités', () => {
    const parent = { DATABASE_URL: 'postgres://invalid.example/test', ALLOW_REMOTE_TEST_DB: '1', PGHOST: 'invalid.example', PGSERVICE: 'external', PGOPTIONS: '-c statement_timeout=1', pgport: '5432', PATH: 'preserved' };
    expect(localDatabaseEnvironment(parent)).toEqual({ PATH: 'preserved' });
    expect(parent.PGHOST).toBe('invalid.example');
    const options = localPostgresOptions(['db']);
    expect(options.mode).toBe('db');
    expect(options.host).toBe('127.0.0.1');
    expect(options.database).toBe('molopay_test');
  });
  it('refuse les arguments supplémentaires', () => {
    expect(() => localPostgresOptions(['db', 'extra'])).toThrow('LOCAL_DB_MODE_INVALID');
  });
});
