'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

/** Assertion WebAuthn brute rendue par l'authentificateur (navigateur). */
export type RawAssertion = {
  readonly credentialId: Uint8Array;
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly signature: Uint8Array;
};

type Outcome = { readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary };

/** Appels injectés : routes réelles et authentificateur du navigateur (`browserStaffLoginPorts`). */
export type StaffLoginPorts = {
  readonly requestChallenge: (login: string) => Promise<({ readonly ok: true; readonly challengeId: string; readonly challenge: string; readonly rpId: string }) | { readonly ok: false; readonly problem: ProblemSummary }>;
  readonly getAssertion: (input: { readonly challenge: Uint8Array; readonly rpId: string }) => Promise<RawAssertion>;
  readonly openSession: (body: Readonly<Record<'challengeId' | 'credentialId' | 'clientDataJSON' | 'authenticatorData' | 'signature', string>>) => Promise<Outcome>;
};

const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * SEC-AUTH-004 / D62 (ADR-0007 proposé) : connexion par clé de sécurité.
 * Aucun mot de passe ; le geste et la vérification de l'utilisateur sont
 * demandés par l'authentificateur. Message d'échec générique (aucun oracle).
 */
export function StaffLogin({ ports, onSignedIn }: { readonly ports: StaffLoginPorts; readonly onSignedIn: () => void }): ReactElement {
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
        credentialId: base64url(assertion.credentialId),
        clientDataJSON: base64url(assertion.clientDataJSON),
        authenticatorData: base64url(assertion.authenticatorData),
        signature: base64url(assertion.signature),
      });
      if (session.ok) {
        onSignedIn();
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
      <h1>Back-office MoloPay</h1>
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
