import { describe, expect, it } from 'vitest';
import { otpSmsText } from './sms.port';
import { twilioConfigFromEnv, twilioRequest, twilioSmsSender, type TwilioConfig } from './twilio-sms';

const SID = `AC${'a'.repeat(32)}`;
const KEY = `SK${'b'.repeat(32)}`;
const SECRET = 'c'.repeat(32);
const TOKEN = 'd'.repeat(32);
const SERVICE = `MG${'e'.repeat(32)}`;

const CONFIG: TwilioConfig = { accountSid: SID, username: KEY, password: SECRET, sender: { from: '+15005550006' }, baseUrl: 'https://api.twilio.com' };

describe('D1 / F-ACC-001 adaptateur SMS Twilio', () => {
  it('fermé par défaut : configuration absente, incomplète, invalide ou ambiguë → null', () => {
    const cases: Record<string, string>[] = [
      {},
      { TWILIO_ACCOUNT_SID: SID, TWILIO_FROM: '+15005550006' },
      { TWILIO_ACCOUNT_SID: 'ACnope', TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006' },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'court', TWILIO_FROM: '+15005550006' },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_API_KEY_SID: KEY, TWILIO_FROM: '+15005550006' },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006', TWILIO_MESSAGING_SERVICE_SID: SERVICE },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '0690000000' },
      { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_MESSAGING_SERVICE_SID: 'MGnope' },
    ];
    for (const env of cases) expect(twilioConfigFromEnv(env), JSON.stringify(Object.keys(env))).toBeNull();
  });

  it('configuration valide : clé d’API prioritaire, sinon SID de compte + jeton ; un seul expéditeur', () => {
    expect(twilioConfigFromEnv({ TWILIO_ACCOUNT_SID: SID, TWILIO_API_KEY_SID: KEY, TWILIO_API_KEY_SECRET: SECRET, TWILIO_FROM: '+15005550006' }))
      .toMatchObject({ accountSid: SID, username: KEY, password: SECRET, sender: { from: '+15005550006' } });
    expect(twilioConfigFromEnv({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_MESSAGING_SERVICE_SID: SERVICE }))
      .toMatchObject({ username: SID, password: TOKEN, sender: { messagingServiceSid: SERVICE } });
  });

  it('requête conforme à la documentation : POST …/Accounts/{SID}/Messages.json, Basic, formulaire To/Body/From', () => {
    const request = twilioRequest(CONFIG, { phone: '+237690000000', text: otpSmsText('123456') });
    expect(request.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(request.headers['authorization']).toBe(`Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`);
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(request.body);
    expect([...form.keys()].sort()).toEqual(['Body', 'From', 'To']);
    expect(form.get('To')).toBe('+237690000000');
    expect(form.get('Body')).toContain('123456');
    const viaService = new URLSearchParams(twilioRequest({ ...CONFIG, sender: { messagingServiceSid: SERVICE } }, { phone: '+237690000000', text: 'x' }).body);
    expect(viaService.get('MessagingServiceSid')).toBe(SERVICE);
    expect(viaService.has('From')).toBe(false);
    expect(() => twilioRequest(CONFIG, { phone: '690000000', text: 'x' })).toThrow('SMS_RECIPIENT_INVALID');
  });

  it('réponse : 2xx avec identifiant SM… accepté ; refus, échec ou panne → erreur sans numéro ni code', async () => {
    const reply = (status: number, body: unknown) => () => Promise.resolve({ status, json: () => Promise.resolve(body) });
    const send = (fetcher: Parameters<typeof twilioSmsSender>[1]): Promise<{ readonly providerRef: string }> => twilioSmsSender(CONFIG, fetcher).send({ phone: '+237690000000', text: otpSmsText('987654') });
    await expect(send(reply(201, { sid: `SM${'f'.repeat(32)}`, status: 'queued' }))).resolves.toEqual({ providerRef: `SM${'f'.repeat(32)}` });
    const failures: Promise<{ readonly providerRef: string }>[] = [
      send(reply(400, { code: 21211, message: 'invalid' })),
      send(reply(201, { sid: `SM${'f'.repeat(32)}`, status: 'failed' })),
      send(reply(201, { status: 'queued' })),
      send(reply(500, null)),
      send(reply(302, { sid: `SM${'f'.repeat(32)}`, status: 'queued' })),
      send(reply(201, { sid: 'SMcourt', status: 'queued' })),
      send(() => Promise.reject(new Error('ECONNRESET +237690000000'))),
    ];
    for (const failure of failures) {
      const error = await failure.then(() => null, (caught: unknown) => caught as Error);
      expect(error?.message).toMatch(/^SMS_PROVIDER_(REFUSED|UNREACHABLE)$/);
      expect(error?.message).not.toMatch(/237690000000|987654/);
    }
  });
});
