import { createPublicKey, verify } from 'node:crypto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceKeyStore, StoredDeviceKey } from '../lib/device-key';
import { generateDeviceKey } from '../lib/device-key';
import { BrowserLogin, BrowserSignup } from './browser-device-auth';

function memoryStore(initial: StoredDeviceKey | null = null): DeviceKeyStore & { readonly current: () => StoredDeviceKey | null } {
  let record = initial;
  return {
    load: () => Promise.resolve(record),
    save: (value) => { record = value; return Promise.resolve(); },
    clear: () => { record = null; return Promise.resolve(); },
    current: () => record,
  };
}

const DEVICE = '019ab900-0000-7000-8000-0000000000d1';

describe('D71 client web : inscription puis connexion avec la clé de ce navigateur', () => {
  it('inscription : la clé publique envoyée est celle de la clé conservée, avec l’appareil rendu par le serveur', async () => {
    const user = userEvent.setup();
    const store = memoryStore();
    const signup = vi.fn((input: { devicePublicKey: string }) => Promise.resolve({ ok: true as const, value: { accountId: '019ab900-0000-7000-8000-0000000000a1', deviceId: DEVICE, accessExpiresAt: '2026-11-24T12:00:00.000Z', sent: input.devicePublicKey } }));
    const onComplete = vi.fn();
    render(<BrowserSignup locale="fr" store={store} ports={{ requestOtp: () => Promise.resolve({ ok: true, value: { challengeId: '019ab900-0000-7000-8000-0000000000c1', expiresAt: '2026-11-24T12:05:00.000Z' } }), signup }} onComplete={onComplete} />);
    await user.type(screen.getByLabelText(/Numéro de téléphone/i), '+237690000000');
    await user.click(screen.getByRole('button', { name: /Recevoir un code SMS/i }));
    await user.type(await screen.findByLabelText(/Code SMS/i), '123456');
    await user.type(screen.getByLabelText(/Code PIN/i), '739154');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Créer mon compte/i }));
    await waitFor(() => { expect(onComplete).toHaveBeenCalledOnce(); });
    const saved = store.current();
    expect(saved?.deviceId).toBe(DEVICE);
    expect(saved?.privateKey.extractable).toBe(false);
    // La clé conservée signe ce que la clé publique envoyée vérifie.
    const sent = signup.mock.calls[0]?.[0].devicePublicKey ?? '';
    const message = new TextEncoder().encode('preuve');
    const signature = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, saved!.privateKey, message));
    expect(verify(null, message, createPublicKey({ key: Buffer.from(sent, 'base64'), format: 'der', type: 'spki' }), signature)).toBe(true);
  });

  it('connexion : appareil enrôlé dans ce navigateur → défi signé par sa clé ; sinon, indisponibilité lisible', async () => {
    const user = userEvent.setup();
    const key = await generateDeviceKey();
    const login = vi.fn(async (input: { deviceId: string; pin: string; signMessage: (message: Uint8Array) => Promise<string> }) => {
      const signature = await input.signMessage(new Uint8Array([1, 2, 3]));
      expect(verify(null, Buffer.from([1, 2, 3]), createPublicKey({ key: Buffer.from(key.publicKeySpki, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64'))).toBe(true);
      return { ok: true as const, value: { accountId: '019ab900-0000-7000-8000-0000000000a1', accessExpiresAt: '2026-11-24T12:00:00.000Z' } };
    });
    const onComplete = vi.fn();
    const { unmount } = render(<BrowserLogin locale="fr" store={memoryStore({ deviceId: DEVICE, privateKey: key.privateKey })} login={login} onComplete={onComplete} />);
    await user.type(await screen.findByLabelText(/Code PIN/i), '739154');
    await user.click(screen.getByRole('button', { name: /Se connecter/i }));
    await waitFor(() => { expect(onComplete).toHaveBeenCalledOnce(); });
    expect(login.mock.calls[0]?.[0]).toMatchObject({ deviceId: DEVICE, pin: '739154' });
    unmount();
    render(<BrowserLogin locale="fr" store={memoryStore()} />);
    expect(await screen.findByText(/Aucune clé d’appareil n’est enrôlée dans ce navigateur/)).toBeInTheDocument();
  });
});
