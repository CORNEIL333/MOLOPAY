'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { fromBase64url, toBase64url } from '../lib/base64url';

export type PartnerRole = 'MANAGER' | 'SELLER';

/** Assertion WebAuthn brute rendue par l'authentificateur (navigateur). */
export type RawAssertion = {
  readonly credentialId: Uint8Array;
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
};

/** Appels injectés : routes réelles du portail et authentificateur du navigateur (`browserPartnerLoginPorts`). */
export type PartnerLoginPorts = {
  readonly requestChallenge: (login: string) => Promise<({ readonly ok: true; readonly challengeId: string; readonly challenge: string; readonly rpId: string }) | { readonly ok: false; readonly problem: ProblemSummary }>;
  readonly getAssertion: (input: { readonly challenge: Uint8Array; readonly rpId: string }) => Promise<RawAssertion>;
  readonly openSession: (body: Readonly<Record<'challengeId' | 'credentialId' | 'clientDataJSON' | 'authenticatorData' | 'signature', string>>) => Promise<{ readonly ok: true; readonly role: PartnerRole } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;

/**
 * SEC-AUTH-006 / D63 : connexion du gérant ou du vendeur par clé de
 * sécurité, sans mot de passe ; message d'échec générique (aucun oracle).
 * Le rôle renvoyé par le serveur ne sert qu'à l'orientation : chaque route
 * revérifie le rôle côté serveur.
 */
export function PartnerLogin({ ports, onSignedIn }: { readonly ports: PartnerLoginPorts; readonly onSignedIn: (role: PartnerRole) => void }): ReactElement {
  const loginId = useId();
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!LOGIN.test(login)) {
      setError('Identifiant invalide (minuscules, chiffres, point, tiret).');
      return;
    }
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const challenge = await ports.requestChallenge(login);
      if (!challenge.ok) {
        setProblem(challenge.problem);
        return;
      }
      const assertion = await ports.getAssertion({ challenge: fromBase64url(challenge.challenge), rpId: challenge.rpId });
      const session = await ports.openSession({
        challengeId: challenge.challengeId,
        credentialId: toBase64url(assertion.credentialId),
        clientDataJSON: toBase64url(assertion.clientDataJSON),
        authenticatorData: toBase64url(assertion.authenticatorData),
        signature: toBase64url(assertion.signature),
      });
      if (session.ok) {
        onSignedIn(session.role);
      } else {
        setProblem(session.problem);
      }
    } catch {
      setProblem({ title: 'Connexion impossible', detail: 'La clé de sécurité n’a pas confirmé la connexion. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Portail partenaire MoloPay</h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField id={loginId} label="Identifiant" autoComplete="username webauthn" value={login} error={error} onChange={(event) => { setLogin(event.target.value.trim()); }} />
        <Button type="submit" disabled={pending}>
          Se connecter avec ma clé de sécurité
        </Button>
      </form>
    </section>
  );
}
