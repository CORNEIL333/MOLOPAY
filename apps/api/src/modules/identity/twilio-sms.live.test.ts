import { describe, expect, it } from 'vitest';
import { twilioConfigFromEnv, twilioSmsSender, type TwilioConfig } from './twilio-sms';

/**
 * D1 : environnement de test officiel de Twilio (identifiants de test : aucun
 * SMS réel, aucun frais). Exige TWILIO_TEST_ACCOUNT_SID et TWILIO_TEST_AUTH_TOKEN
 * (console Twilio > Account > API keys & tokens > Test credentials), fournis
 * hors du dépôt. Numéros « magiques » de la documentation : expéditeur
 * +15005550006 valide ; destinataire +15005550001 invalide (21211).
 */
function testConfig(): TwilioConfig {
  const config = twilioConfigFromEnv({
    TWILIO_ACCOUNT_SID: process.env['TWILIO_TEST_ACCOUNT_SID'],
    TWILIO_AUTH_TOKEN: process.env['TWILIO_TEST_AUTH_TOKEN'],
    TWILIO_FROM: '+15005550006',
  });
  if (config === null) throw new Error('TWILIO_TEST_CREDENTIALS_MISSING : identifiants de test Twilio absents');
  return config;
}

describe('D1 / F-ACC-001 Twilio, environnement de test officiel', () => {
  it('envoi accepté vers un numéro valide', async () => {
    const { providerRef } = await twilioSmsSender(testConfig()).send({ phone: '+237690000000', text: 'MoloPay : test d’intégration.' });
    expect(providerRef).toMatch(/^SM[0-9a-f]{32}$/);
  });

  it('numéro invalide refusé par Twilio (SMS_PROVIDER_REFUSED)', async () => {
    await expect(twilioSmsSender(testConfig()).send({ phone: '+15005550001', text: 'MoloPay : test d’intégration.' })).rejects.toThrow('SMS_PROVIDER_REFUSED');
  });
});
