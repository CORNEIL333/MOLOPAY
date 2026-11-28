import type { SmsSender } from './sms.port';

/**
 * D1 (24 novembre : Twilio retenu par le fondateur) : adaptateur réel de
 * l'API Messages de Twilio — `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`,
 * authentification HTTP Basic (clé d'API `SK…` + secret, ou SID de compte +
 * jeton), corps `application/x-www-form-urlencoded` (`To`, `Body`, et `From`
 * ou `MessagingServiceSid`). Fermé par défaut : sans configuration complète et
 * valide, aucun envoi (l'inscription répond 503 SMS_UNCONFIGURED).
 *
 * Aucun secret dans le code ni dans les journaux : identifiants lus dans
 * l'environnement ; une erreur ne reprend ni le numéro, ni le texte (qui
 * contient le code), ni la réponse du prestataire.
 */
export type TwilioConfig = {
  readonly accountSid: string;
  readonly username: string;
  readonly password: string;
  readonly sender: { readonly from: string } | { readonly messagingServiceSid: string };
  readonly baseUrl: string;
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ readonly status: number; json(): Promise<unknown> }>;

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/;
const API_KEY_SID = /^SK[0-9a-f]{32}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const SECRET = /^[A-Za-z0-9]{16,128}$/;
const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;
export const TWILIO_API_BASE = 'https://api.twilio.com';

/** Configuration depuis l'environnement ; `null` si incomplète ou invalide (fermé par défaut). */
export function twilioConfigFromEnv(env: NodeJS.ProcessEnv): TwilioConfig | null {
  const accountSid = env['TWILIO_ACCOUNT_SID'];
  if (accountSid === undefined || !ACCOUNT_SID.test(accountSid)) return null;
  const keySid = env['TWILIO_API_KEY_SID'];
  const keySecret = env['TWILIO_API_KEY_SECRET'];
  const authToken = env['TWILIO_AUTH_TOKEN'];
  let username: string;
  let password: string;
  if (keySid !== undefined || keySecret !== undefined) {
    if (keySid === undefined || keySecret === undefined || !API_KEY_SID.test(keySid) || !SECRET.test(keySecret)) return null;
    username = keySid;
    password = keySecret;
  } else {
    if (authToken === undefined || !SECRET.test(authToken)) return null;
    username = accountSid;
    password = authToken;
  }
  const from = env['TWILIO_FROM'];
  const service = env['TWILIO_MESSAGING_SERVICE_SID'];
  if ((from === undefined) === (service === undefined)) return null; // exactement un expéditeur
  if (from !== undefined && !E164.test(from)) return null;
  if (service !== undefined && !MESSAGING_SERVICE_SID.test(service)) return null;
  return {
    accountSid,
    username,
    password,
    sender: from !== undefined ? { from } : { messagingServiceSid: service ?? '' },
    baseUrl: TWILIO_API_BASE,
  };
}

/** Requête exacte (méthode, URL, en-têtes, corps) ; exportée pour être vérifiée par les tests. */
export function twilioRequest(config: TwilioConfig, input: { readonly phone: string; readonly text: string }): { url: string; headers: Record<string, string>; body: string } {
  if (!E164.test(input.phone)) throw new Error('SMS_RECIPIENT_INVALID');
  if (input.text.length === 0 || input.text.length > 1600) throw new Error('SMS_TEXT_INVALID');
  const form = new URLSearchParams();
  form.set('To', input.phone);
  form.set('Body', input.text);
  if ('from' in config.sender) form.set('From', config.sender.from);
  else form.set('MessagingServiceSid', config.sender.messagingServiceSid);
  return {
    url: `${config.baseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    headers: {
      authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: form.toString(),
  };
}

export function twilioSmsSender(config: TwilioConfig, fetcher: Fetch = fetch): SmsSender {
  return {
    async send(input) {
      const request = twilioRequest(config, input);
      let response: Awaited<ReturnType<Fetch>>;
      try {
        response = await fetcher(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new Error('SMS_PROVIDER_UNREACHABLE');
      }
      if (response.status < 200 || response.status > 299) throw new Error('SMS_PROVIDER_REFUSED');
      const body = (await response.json().catch(() => null)) as { sid?: unknown; status?: unknown } | null;
      if (body === null || typeof body.sid !== 'string' || !MESSAGE_SID.test(body.sid) || body.status === 'failed' || body.status === 'undelivered') {
        throw new Error('SMS_PROVIDER_REFUSED');
      }
      return { providerRef: body.sid };
    },
  };
}
