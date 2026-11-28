'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState } from '@achat/ui';
import { useState, type ReactElement } from 'react';
import type { Locale } from '../i18n';
import { acceptCurrentTerms, type TermsOutcome } from '../lib/terms';

/**
 * F-ACC-004 : conditions en vigueur non acceptées. Aucun nouvel objectif ni
 * activation n'est possible avant l'acceptation (le serveur le refuse
 * aussi) ; annuler, verrouiller ou bloquer son compte reste possible.
 */
export function TermsAcceptance({
  locale,
  version,
  accept,
  onAccepted,
}: {
  readonly locale: Locale;
  readonly version: string;
  readonly accept?: () => Promise<TermsOutcome>;
  readonly onAccepted?: () => void;
}): ReactElement {
  const isEn = locale === 'en';
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const errorTitle = isEn ? 'Acceptance not recorded' : 'Acceptation non enregistrée';

  async function submit(): Promise<void> {
    if (!checked || pending) return;
    setPending(true);
    setProblem(null);
    try {
      const outcome = accept === undefined ? await acceptCurrentTerms(errorTitle) : await accept();
      if (outcome.ok) {
        setDone(true);
        if (onAccepted === undefined) window.location.reload();
        else onAccepted();
      } else {
        setProblem(outcome.problem);
      }
    } catch {
      setProblem({ title: errorTitle, detail: isEn ? 'Connection interrupted. Reload before trying again.' : 'Connexion interrompue. Rechargez la page avant de réessayer.' });
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return <p role="status">{isEn ? `Terms accepted (version ${version}).` : `Conditions acceptées (version ${version}).`}</p>;
  }
  return (
    <section aria-labelledby="terms-acceptance-title">
      <h2 id="terms-acceptance-title">{isEn ? 'New terms to accept' : 'Nouvelles conditions à accepter'}</h2>
      <p>
        {isEn
          ? `The terms of use and privacy policy have changed (version ${version}). You must accept them before starting or activating a goal. Cancelling, locking or blocking your account remains possible.`
          : `Les conditions générales et la politique de confidentialité ont changé (version ${version}). Vous devez les accepter avant de créer ou d’activer un objectif. Annuler, verrouiller ou bloquer votre compte reste possible.`}
      </p>
      {problem === null ? null : <ErrorState problem={problem} />}
      <label>
        <input type="checkbox" checked={checked} onChange={(event) => { setChecked(event.currentTarget.checked); }} disabled={pending} />{' '}
        {isEn ? 'I have read and accept the terms in force' : 'J’ai lu et j’accepte les conditions en vigueur'}
      </label>
      <Button type="button" disabled={!checked || pending} onClick={() => { void submit(); }}>
        {isEn ? 'Accept' : 'Accepter'}
      </Button>
    </section>
  );
}
