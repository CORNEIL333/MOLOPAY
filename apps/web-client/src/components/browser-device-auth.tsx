'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Locale } from '../i18n';
import type { ClientLoginResult, SignupResult } from '../lib/client-auth';
import { deviceSigner, generateDeviceKey, indexedDbDeviceKeyStore, type DeviceKeyStore, type GeneratedDeviceKey } from '../lib/device-key';
import { DeviceLoginForm, DeviceSignupForm, type DeviceLoginPorts, type DeviceSignupPorts } from './device-auth-forms';

/**
 * Inscription web : la clé d'appareil est générée par ce navigateur au moment
 * de l'envoi, puis conservée (non exportable) avec l'identifiant d'appareil
 * rendu par le serveur.
 */
export function BrowserSignup({
  locale,
  store = indexedDbDeviceKeyStore(),
  generate = generateDeviceKey,
  ports,
  onComplete,
}: {
  readonly locale: Locale;
  readonly store?: DeviceKeyStore;
  readonly generate?: () => Promise<GeneratedDeviceKey>;
  readonly ports?: Omit<DeviceSignupPorts, 'providePublicKey'>;
  readonly onComplete?: (result: SignupResult) => void;
}): ReactElement {
  const pendingKey = useRef<GeneratedDeviceKey | null>(null);
  return (
    <DeviceSignupForm
      locale={locale}
      ports={{
        ...ports,
        providePublicKey: async () => {
          const key = await generate();
          pendingKey.current = key;
          return key.publicKeySpki;
        },
      }}
      onComplete={(result) => {
        const key = pendingKey.current;
        pendingKey.current = null;
        const done = (): void => {
          if (onComplete === undefined) window.location.assign('/objectifs');
          else onComplete(result);
        };
        if (key === null) { done(); return; }
        // Compte créé : la session est ouverte même si le stockage échoue (reconnexion impossible
        // depuis ce navigateur seulement ; aucune donnée n'est perdue côté serveur).
        void store.save({ deviceId: result.deviceId, privateKey: key.privateKey }).catch(() => undefined).finally(done);
      }}
    />
  );
}

/** Connexion web : clé d'appareil de ce navigateur (si enrôlée) + PIN. */
export function BrowserLogin({
  locale,
  store = indexedDbDeviceKeyStore(),
  login,
  onComplete,
}: {
  readonly locale: Locale;
  readonly store?: DeviceKeyStore;
  readonly login?: DeviceLoginPorts['login'];
  readonly onComplete?: (result: ClientLoginResult) => void;
}): ReactElement {
  const [ports, setPorts] = useState<DeviceLoginPorts | null>(null);
  useEffect(() => {
    let live = true;
    store.load()
      .then((record) => {
        if (!live) return;
        setPorts(record === null ? {} : { deviceId: record.deviceId, signMessage: deviceSigner(record.privateKey), ...(login === undefined ? {} : { login }) });
      })
      .catch(() => { if (live) setPorts({}); });
    return () => { live = false; };
  }, [store, login]);
  if (ports === null) return <p role="status" aria-busy="true">…</p>;
  return <DeviceLoginForm locale={locale} ports={ports} {...(onComplete === undefined ? {} : { onComplete })} />;
}
