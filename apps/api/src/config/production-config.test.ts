import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { capabilityReport, distinctPeppers, handoverPepperFromEnv, relyingPartyFromEnv } from './production-config';

/**
 * Préparation production : configuration lue et validée au démarrage, fermée
 * par défaut. Aucune valeur n'est jamais recopiée dans un message.
 */
const b64 = (bytes = 32): string => randomBytes(bytes).toString('base64');

describe('Configuration de production — connexions WebAuthn (personnel, partenaires)', () => {
  it('absente : null (connexion fermée, 503) ; présente et valide : domaine et origines https', () => {
    expect(relyingPartyFromEnv({}, 'STAFF')).toBeNull();
    const rp = relyingPartyFromEnv({ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'https://admin.molopay.cm, https://molopay.cm' }, 'STAFF');
    expect(rp?.rpId).toBe('molopay.cm');
    expect([...(rp?.origins ?? [])].sort()).toEqual(['https://admin.molopay.cm', 'https://molopay.cm']);
    expect(relyingPartyFromEnv({ PARTNER_RP_ID: 'partenaires.molopay.cm', PARTNER_RP_ORIGINS: 'https://partenaires.molopay.cm' }, 'PARTNER')?.rpId).toBe('partenaires.molopay.cm');
  });

  it('refuse : configuration partielle, origine hors domaine, http, chemin, joker, domaine invalide (CONFIG_INVALID, variable exacte)', () => {
    for (const [env, variable] of [
      [{ STAFF_RP_ID: 'molopay.cm' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ORIGINS: 'https://molopay.cm' }, 'STAFF_RP_ID'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'https://molopay.evil.cm' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'https://evilmolopay.cm' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'http://admin.molopay.cm' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'https://admin.molopay.cm/back' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: '*' }, 'STAFF_RP_ORIGINS'],
      [{ STAFF_RP_ID: 'https://molopay.cm', STAFF_RP_ORIGINS: 'https://molopay.cm' }, 'STAFF_RP_ID'],
      [{ STAFF_RP_ID: 'molo_pay.cm', STAFF_RP_ORIGINS: 'https://molo_pay.cm' }, 'STAFF_RP_ID'],
      [{ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: '' }, 'STAFF_RP_ORIGINS'],
    ] as const) {
      expect(() => relyingPartyFromEnv(env, 'STAFF'), JSON.stringify(env)).toThrow(new RegExp(`^CONFIG_INVALID: ${variable} `));
    }
  });

  it('hors production seulement : localhost en http accepté (développement)', () => {
    expect(relyingPartyFromEnv({ STAFF_RP_ID: 'localhost', STAFF_RP_ORIGINS: 'http://localhost:3001' }, 'STAFF')?.rpId).toBe('localhost');
    expect(() => relyingPartyFromEnv({ NODE_ENV: 'production', STAFF_RP_ID: 'localhost', STAFF_RP_ORIGINS: 'http://localhost:3001' }, 'STAFF')).toThrow(/^CONFIG_INVALID/);
    // En production, même en https, le domaine localhost est refusé (contrôle du domaine seul).
    expect(() => relyingPartyFromEnv({ NODE_ENV: 'production', STAFF_RP_ID: 'localhost', STAFF_RP_ORIGINS: 'https://localhost' }, 'STAFF')).toThrow(/^CONFIG_INVALID: STAFF_RP_ID /);
  });
});

describe('Configuration de production — poivres', () => {
  it('poivre de remise : absent → null ; 32 à 64 octets en base64 ; message sans la valeur', () => {
    expect(handoverPepperFromEnv({})).toBeNull();
    expect(handoverPepperFromEnv({ HANDOVER_PEPPER: b64() })?.length).toBe(32);
    const short = b64(16);
    expect(() => handoverPepperFromEnv({ HANDOVER_PEPPER: short })).toThrow(/^CONFIG_INVALID: HANDOVER_PEPPER/);
    try {
      handoverPepperFromEnv({ HANDOVER_PEPPER: short });
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });

  it('refuse : deux usages avec le même poivre (PIN, OTP, remise)', () => {
    const same = randomBytes(32);
    expect(() => distinctPeppers({ PIN_PEPPER: same, OTP_PEPPER: same })).toThrow(/^CONFIG_INVALID: PIN_PEPPER et OTP_PEPPER/);
    expect(() => distinctPeppers({ PIN_PEPPER: randomBytes(32), HANDOVER_PEPPER: same, OTP_PEPPER: same })).toThrow(/^CONFIG_INVALID: OTP_PEPPER et HANDOVER_PEPPER|^CONFIG_INVALID: HANDOVER_PEPPER et OTP_PEPPER/);
    expect(() => distinctPeppers({ PIN_PEPPER: randomBytes(32), OTP_PEPPER: randomBytes(32), HANDOVER_PEPPER: null })).not.toThrow();
  });
});

describe('pnpm config:check — capacités ouvertes ou fermées, sans aucune valeur', () => {
  it('liste chaque capacité, sa variable et son état ; aucune valeur recopiée', () => {
    const pin = b64();
    const report = capabilityReport({ DATABASE_URL: 'postgres://u:motdepasse@127.0.0.1/db', PIN_PEPPER: pin, STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'https://molopay.cm' });
    expect(report.capabilities).toMatchObject({
      database: 'CONFIGURED',
      staffLogin: 'CONFIGURED',
      partnerLogin: 'CLOSED',
      pin: 'CONFIGURED',
      otp: 'CLOSED',
      sms: 'CLOSED',
      phoneProtection: 'CLOSED',
      handoverCode: 'CLOSED',
      signedInstructions: 'CLOSED',
    });
    expect(report.status).toBe('OK');
    const text = JSON.stringify(report);
    expect(text).not.toContain('motdepasse');
    expect(text).not.toContain(pin);
  });

  it('configuration invalide : statut INVALID avec le code et la variable, jamais la valeur', () => {
    const report = capabilityReport({ STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'http://secret-host.example' });
    expect(report.status).toBe('INVALID');
    expect(report.errors).toEqual(['CONFIG_INVALID: STAFF_RP_ORIGINS']);
    expect(JSON.stringify(report)).not.toContain('secret-host');
  });

  it('production : la signature des instructions reste fermée (clé en HSM, D5) même si une clé est fournie', () => {
    expect(capabilityReport({ NODE_ENV: 'production', PLATFORM_SIGNING_KEY_PEM: 'x' }).capabilities.signedInstructions).toBe('CLOSED');
  });
});
