'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { fromBase64url, toBase64url } from '../lib/base64url';

export type RawCredential = {
  readonly credentialId: Uint8Array;
  readonly clientDataJSON: Uint8Array;
  readonly authenticatorData: Uint8Array;
  readonly publicKeySpki: Uint8Array;
};

export type StaffEnrollmentPorts = {
  readonly createCredential: (input: { readonly challenge: Uint8Array; readonly login: string }) => Promise<RawCredential>;
  readonly register: (body: Readonly<Record<'challengeId' | 'enrollmentToken' | 'credentialId' | 'clientDataJSON' | 'authenticatorData' | 'publicKeySpki', string>>) => Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;
const CODE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

/**
 * SEC-AUTH-004 / D62 : l'agent enrôle sa clé de sécurité avec le code remis
 * en main propre (défi, challenge, jeton). La clé est créée par
 * l'authentificateur (vérification de l'utilisateur exigée) ; seuls la clé
 * publique et les preuves sont envoyées.
 */
export function StaffEnrollment({ ports }: { readonly ports: StaffEnrollmentPorts }): ReactElement {
  const ids = { login: useId(), code: useId() };
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parts = CODE.exec(code);
    if (!LOGIN.test(login)) {
      setError('Identifiant invalide (minuscules, chiffres, point, tiret).');
      return;
    }
    if (parts === null) {
      setError('Code d’enrôlement invalide : recopiez le code remis, en un seul bloc.');
      return;
    }
    const [, challengeId, challenge, enrollmentToken] = parts;
    if (challengeId === undefined || challenge === undefined || enrollmentToken === undefined) {
      return;
    }
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const credential = await ports.createCredential({ challenge: fromBase64url(challenge), login });
      const result = await ports.register({
        challengeId,
        enrollmentToken,
        credentialId: toBase64url(credential.credentialId),
        clientDataJSON: toBase64url(credential.clientDataJSON),
        authenticatorData: toBase64url(credential.authenticatorData),
        publicKeySpki: toBase64url(credential.publicKeySpki),
      });
      if (result.ok) {
        setDone(true);
        setCode('');
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Enrôlement impossible', detail: 'La clé de sécurité n’a pas été créée. Réessayez ou demandez un nouveau code.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Enrôler ma clé de sécurité</h1>
      {done ? <p role="status">Clé enregistrée. Vous pouvez vous connecter.</p> : null}
      {problem === null ? null : <ErrorState problem={problem} />}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField id={ids.login} label="Identifiant" autoComplete="username" value={login} onChange={(event) => { setLogin(event.target.value.trim()); }} />
        <TextField id={ids.code} label="Code d’enrôlement" autoComplete="off" value={code} error={error} onChange={(event) => { setCode(event.target.value.trim()); }} />
        <Button type="submit" disabled={pending}>Enregistrer ma clé de sécurité</Button>
      </form>
    </section>
  );
}
