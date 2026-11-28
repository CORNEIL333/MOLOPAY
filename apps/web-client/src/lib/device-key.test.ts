import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDeviceChallengeMessage } from './client-auth';
import { deviceSigner, generateDeviceKey } from './device-key';

/** D71 / SEC-AUTH-001 (web) : clé d'appareil du navigateur, vérifiée comme le serveur la vérifie. */
describe('clé d’appareil Ed25519 du navigateur', () => {
  it('clé privée non exportable : aucun script ne peut en lire les octets', async () => {
    const key = await generateDeviceKey();
    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow();
  });

  it('clé publique SPKI base64 et signature de 64 octets vérifiées par node:crypto (même primitive que le serveur)', async () => {
    const key = await generateDeviceKey();
    const publicKey = createPublicKey({ key: Buffer.from(key.publicKeySpki, 'base64'), format: 'der', type: 'spki' });
    expect(publicKey.asymmetricKeyType).toBe('ed25519');
    const message = buildDeviceChallengeMessage('LOGIN', '019ab900-0000-7000-8000-000000000001', '019ab900-0000-7000-8000-000000000002', Buffer.alloc(32, 7).toString('base64url'));
    const signature = Buffer.from(await deviceSigner(key.privateKey)(message), 'base64');
    expect(signature).toHaveLength(64);
    expect(verify(null, message, publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.concat([message, Buffer.from([0])]), publicKey, signature)).toBe(false);
  });

  it('navigateur sans Ed25519 : DEVICE_KEY_UNSUPPORTED, aucune clé de remplacement', async () => {
    const refusing = { generateKey: () => Promise.reject(new Error('NotSupportedError')) } as unknown as SubtleCrypto;
    await expect(generateDeviceKey(refusing)).rejects.toThrow('DEVICE_KEY_UNSUPPORTED');
  });
});
