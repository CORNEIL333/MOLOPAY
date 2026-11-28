import { Pool } from 'pg';
import { assertDirectEndpoint, assertSecureDatabaseUrl } from '../apps/api/src/http/database';
import { piiKeysFromEnv, type PiiKeys } from '../apps/api/src/modules/identity/phone-key';
import { twilioConfigFromEnv, twilioSmsSender, type TwilioConfig } from '../apps/api/src/modules/identity/twilio-sms';
import { runSmsWorker, type SmsDispatchOutcome } from '../apps/api/src/workflows/sms-worker';

/**
 * D121, tranche 2 : `pnpm notify:worker`, travailleur SMS de production.
 *
 * - Connexion avec le compte `molopay_notifier`, rôle `notification_worker`
 *   pris au démarrage de la session (point d'accès direct de Neon, TLS
 *   vérifié) : il ne peut que prendre, confirmer ou replanifier une
 *   notification et lire le numéro chiffré du bail en cours.
 * - Fermé sans configuration : sans Twilio complet (D1) ou sans clés de
 *   protection du numéro (C14), il ne démarre pas (code 2, `SMS_UNCONFIGURED`
 *   ou `PII_KEYS_UNCONFIGURED`) ; rien n'est simulé.
 * - Journal : une ligne JSON par envoi ou nouvel essai, avec le seul résultat
 *   (jamais de numéro, de texte ni d'identifiant de client).
 */
export function notifierDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env['NOTIFIER_DATABASE_URL']?.trim() ?? '';
  if (url === '') throw new Error('NOTIFIER_DATABASE_MISSING');
  assertSecureDatabaseUrl(url, env);
  // Rôle pris par le paramètre `options` au démarrage de la session : point d'accès direct exigé.
  assertDirectEndpoint(url);
  return url;
}

/** Délai d'attente quand la file est vide (1 à 60 s, 5 s par défaut). */
export function idleDelayFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env['NOTIFIER_IDLE_MS']?.trim() ?? '';
  if (raw === '') return 5000;
  if (!/^[0-9]{1,5}$/.test(raw) || Number(raw) < 1000 || Number(raw) > 60_000) throw new Error('CONFIG_INVALID: NOTIFIER_IDLE_MS');
  return Number(raw);
}

export type SmsWorkerConfig = { readonly url: string; readonly idleDelayMs: number; readonly twilio: TwilioConfig };

/** Configuration complète, ou le code de fermeture ; aucune valeur n'est recopiée. */
export function smsWorkerConfigFromEnv(env: NodeJS.ProcessEnv): SmsWorkerConfig {
  const url = notifierDatabaseUrl(env);
  const idleDelayMs = idleDelayFromEnv(env);
  const twilio = twilioConfigFromEnv(env);
  if (twilio === null) throw new Error('SMS_UNCONFIGURED');
  return { url, idleDelayMs, twilio };
}

function codeOf(error: unknown): string {
  return error instanceof Error ? (/^([A-Z][A-Z0-9_]+)/.exec(error.message)?.[1] ?? 'NOTIFIER_FAILED') : 'NOTIFIER_FAILED';
}

async function main(): Promise<number> {
  let config: SmsWorkerConfig;
  let piiKeys: PiiKeys | null;
  try {
    config = smsWorkerConfigFromEnv(process.env);
    piiKeys = await piiKeysFromEnv(process.env);
    if (piiKeys === null) throw new Error('PII_KEYS_UNCONFIGURED');
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'CLOSED', code: codeOf(error) })}\n`);
    return 2;
  }
  const pool = new Pool({ connectionString: config.url, options: '-c role=notification_worker', application_name: 'molopay-notify-worker', max: 2, statement_timeout: 10_000, connectionTimeoutMillis: 10_000 });
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => controller.abort());
  const log = (outcome: SmsDispatchOutcome): void => {
    if (outcome !== 'IDLE') process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), outcome })}\n`);
  };
  try {
    await runSmsWorker({ pool, sms: twilioSmsSender(config.twilio), piiKeys, idleDelayMs: config.idleDelayMs, signal: controller.signal, onOutcome: log });
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
