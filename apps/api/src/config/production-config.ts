import type { RelyingParty } from '../modules/admin/webauthn';
import { instructionSigningArnFromEnv } from '../crypto/instruction-signer';
import { assertSecureDatabaseUrl } from '../http/database';
import { pinPepperFromEnv } from '../modules/identity/pin.store';
import { twilioConfigFromEnv } from '../modules/identity/twilio-sms';

/**
 * Préparation production : chaque capacité de l'API est lue et validée au
 * démarrage, FERMÉE si sa configuration est absente (la route répond 503), et
 * le démarrage est refusé si elle est présente mais invalide. Aucun message
 * ne recopie une valeur (secret, adresse, nom d'hôte interne) : seulement le
 * code et le nom de la variable.
 */
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function invalid(variable: string, why: string): never {
  throw new Error(`CONFIG_INVALID: ${variable} ${why}`);
}

/**
 * Partie de confiance WebAuthn (connexion par clé d'accès du personnel ou des
 * partenaires) : `<PRÉFIXE>_RP_ID` (domaine) et `<PRÉFIXE>_RP_ORIGINS`
 * (origines https séparées par des virgules, chacune sur ce domaine ou un
 * sous-domaine). Les deux absentes : null (connexion fermée).
 */
export function relyingPartyFromEnv(env: NodeJS.ProcessEnv, prefix: 'STAFF' | 'PARTNER'): RelyingParty | null {
  const idName = `${prefix}_RP_ID`;
  const originsName = `${prefix}_RP_ORIGINS`;
  const rpId = env[idName]?.trim();
  const rawOrigins = env[originsName];
  if (rpId === undefined && rawOrigins === undefined) return null;
  if (rpId === undefined || rpId === '' || !HOST.test(rpId)) invalid(idName, 'doit être un nom de domaine');
  const production = env['NODE_ENV'] === 'production';
  if (production && rpId === 'localhost') invalid(idName, 'localhost interdit en production');
  const items = (rawOrigins ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '');
  if (items.length === 0) invalid(originsName, 'au moins une origine');
  const origins = new Set<string>();
  for (const item of items) {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      invalid(originsName, 'origine illisible');
    }
    const localDev = !production && url.protocol === 'http:' && url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !localDev) invalid(originsName, 'https exigé');
    if (url.origin !== item.replace(/\/$/, '') || url.pathname !== '/' || url.search !== '' || url.hash !== '') invalid(originsName, 'origine seule, sans chemin');
    if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) invalid(originsName, 'hors du domaine de la partie de confiance');
    origins.add(url.origin);
  }
  return { rpId, origins };
}

/** Poivre du code de remise (F-HND) : absent → null (remise fermée) ; sinon 32 à 64 octets en base64. */
export function handoverPepperFromEnv(env: NodeJS.ProcessEnv): Uint8Array | null {
  const raw = env['HANDOVER_PEPPER']?.trim();
  if (raw === undefined || raw === '') return null;
  const pepper = Buffer.from(raw, 'base64');
  if (pepper.length < 32 || pepper.length > 64) invalid('HANDOVER_PEPPER', 'doit être du base64 de 32 à 64 octets');
  return pepper;
}

/** Un poivre par usage : la même valeur pour deux usages lierait leurs empreintes. */
export function distinctPeppers(peppers: Readonly<Record<string, Uint8Array | null | undefined>>): void {
  const entries = Object.entries(peppers).filter((entry): entry is [string, Uint8Array] => entry[1] instanceof Uint8Array);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [a, left] = entries[i] as [string, Uint8Array];
      const [b, right] = entries[j] as [string, Uint8Array];
      if (Buffer.from(left).equals(Buffer.from(right))) throw new Error(`CONFIG_INVALID: ${a} et ${b} doivent être différents`);
    }
  }
}

export type CapabilityState = 'CONFIGURED' | 'CLOSED';
export type CapabilityReport = {
  readonly status: 'OK' | 'INVALID';
  readonly capabilities: Readonly<Record<'database' | 'staffLogin' | 'partnerLogin' | 'pin' | 'otp' | 'sms' | 'phoneProtection' | 'handoverCode' | 'signedInstructions', CapabilityState>>;
  readonly errors: string[];
};

function code(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const match = /^([A-Z_]+):? ?([A-Z_]+)?/.exec(message);
  return match === null ? 'CONFIG_INVALID' : [match[1], match[2]].filter(Boolean).join(': ');
}

/** `pnpm config:check` : état de chaque capacité, sans aucune valeur ; `INVALID` si une configuration présente est fausse. */
export function capabilityReport(env: NodeJS.ProcessEnv): CapabilityReport {
  const errors: string[] = [];
  const check = (present: boolean, load: () => unknown): CapabilityState => {
    if (!present) return 'CLOSED';
    try {
      return load() === null ? 'CLOSED' : 'CONFIGURED';
    } catch (error) {
      errors.push(code(error));
      return 'CLOSED';
    }
  };
  const has = (name: string): boolean => (env[name]?.trim() ?? '') !== '';
  const peppers: Record<string, Uint8Array | null> = { PIN_PEPPER: null, OTP_PEPPER: null, HANDOVER_PEPPER: null };
  const capabilities = {
    database: check(has('DATABASE_URL'), () => assertSecureDatabaseUrl(env['DATABASE_URL'] ?? '', env)),
    staffLogin: check(has('STAFF_RP_ID') || env['STAFF_RP_ORIGINS'] !== undefined, () => relyingPartyFromEnv(env, 'STAFF')),
    partnerLogin: check(has('PARTNER_RP_ID') || env['PARTNER_RP_ORIGINS'] !== undefined, () => relyingPartyFromEnv(env, 'PARTNER')),
    pin: check(has('PIN_PEPPER'), () => (peppers['PIN_PEPPER'] = pinPepperFromEnv(env, 'PIN_PEPPER'))),
    otp: check(has('OTP_PEPPER'), () => (peppers['OTP_PEPPER'] = pinPepperFromEnv(env, 'OTP_PEPPER'))),
    sms: check(true, () => twilioConfigFromEnv(env)),
    phoneProtection: check(has('PHONE_INDEX_KEY_WRAPPED') && (has('PII_KMS_KEY_ARN') || has('PII_LOCAL_MASTER_KEY')), () => {
      if (!has('PII_KMS_KEY_ARN') && env['NODE_ENV'] === 'production') throw new Error('CONFIG_INVALID: PII_LOCAL_MASTER_KEY interdite en production');
      return true;
    }),
    handoverCode: check(has('HANDOVER_PEPPER'), () => (peppers['HANDOVER_PEPPER'] = handoverPepperFromEnv(env))),
    // D5 : signature des instructions par AWS KMS seulement (aucune clé privée dans l'environnement) ;
    // fermée sans INSTRUCTION_SIGNING_KMS_KEY_ARN (pas de versement au lancement tant que le fondateur ne la configure pas).
    signedInstructions: check(has('INSTRUCTION_SIGNING_KMS_KEY_ARN'), () => instructionSigningArnFromEnv(env)),
  };
  try {
    distinctPeppers(peppers);
  } catch (error) {
    errors.push(code(error));
  }
  return { status: errors.length === 0 ? 'OK' : 'INVALID', capabilities, errors };
}
