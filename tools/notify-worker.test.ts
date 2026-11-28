import { describe, expect, it } from 'vitest';
import { idleDelayFromEnv, notifierDatabaseUrl, smsWorkerConfigFromEnv } from './notify-worker';

/** D121, tranche 2 : configuration du travailleur SMS, fermée par défaut, sans valeur recopiée. */
const URL = 'postgresql://molopay_notifier@ep-x.eu-central-1.aws.neon.tech/molopay?sslmode=verify-full';
const TWILIO = { TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'a'.repeat(32), TWILIO_FROM: '+15005550006' };

describe('D121 pnpm notify:worker — configuration', () => {
  it('adresse : obligatoire, TLS vérifié, point d’accès direct (rôle pris au démarrage de la session)', () => {
    expect(() => notifierDatabaseUrl({})).toThrow(/^NOTIFIER_DATABASE_MISSING$/);
    expect(() => notifierDatabaseUrl({ NOTIFIER_DATABASE_URL: '  ' })).toThrow(/^NOTIFIER_DATABASE_MISSING$/);
    expect(() => notifierDatabaseUrl({ NOTIFIER_DATABASE_URL: 'postgresql://n@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require' })).toThrow(/^DATABASE_TLS_REQUIRED/);
    expect(() => notifierDatabaseUrl({ NOTIFIER_DATABASE_URL: 'postgresql://n@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=verify-full' })).toThrow(/^DATABASE_POOLER_FORBIDDEN/);
    expect(notifierDatabaseUrl({ NOTIFIER_DATABASE_URL: URL })).toBe(URL);
  });

  it('attente si la file est vide : 5 s par défaut, bornée de 1 à 60 s', () => {
    expect(idleDelayFromEnv({})).toBe(5000);
    expect(idleDelayFromEnv({ NOTIFIER_IDLE_MS: '1000' })).toBe(1000);
    expect(idleDelayFromEnv({ NOTIFIER_IDLE_MS: '60000' })).toBe(60_000);
    for (const value of ['999', '60001', '5s', '-1', '1e4']) expect(() => idleDelayFromEnv({ NOTIFIER_IDLE_MS: value })).toThrow(/^CONFIG_INVALID: NOTIFIER_IDLE_MS$/);
  });

  it('fermé sans Twilio complet (SMS_UNCONFIGURED) ; complet : configuration rendue', () => {
    expect(() => smsWorkerConfigFromEnv({ NOTIFIER_DATABASE_URL: URL })).toThrow(/^SMS_UNCONFIGURED$/);
    expect(() => smsWorkerConfigFromEnv({ NOTIFIER_DATABASE_URL: URL, TWILIO_ACCOUNT_SID: TWILIO.TWILIO_ACCOUNT_SID })).toThrow(/^SMS_UNCONFIGURED$/);
    const config = smsWorkerConfigFromEnv({ NOTIFIER_DATABASE_URL: URL, ...TWILIO });
    expect(config).toMatchObject({ url: URL, idleDelayMs: 5000 });
    expect(config.twilio.sender).toEqual({ from: '+15005550006' });
  });
});
