'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ChoiceChip, ErrorState } from '@achat/ui';
import { useState, type ReactElement } from 'react';
import type { Locale } from '../i18n';
import { acceptCurrentTerms, type TermsOutcome } from '../lib/terms';

/**
 * F-ACC-004 / C11 : conditions en couches (5 points clés, lecture vocale locale,
 * consentement obligatoire et consentement marketing facultatif séparés et jamais pré-cochés).
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
  const [marketing, setMarketing] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const errorTitle = isEn ? 'Acceptance not recorded' : 'Acceptation non enregistrée';

  const fivePoints = isEn
    ? [
        'Your money is held by the licensed partner institution, not by MoloPay.',
        '0 FCFA to save. The price of your project is locked.',
        'Current limit: regulatory tier ceiling. It increases with your ID.',
        'A problem? "Call me back", answer within 72 h.',
        'You can cancel and close your account at any time.',
      ]
    : [
        'Votre argent est gardé par l’établissement partenaire agréé, pas par MoloPay.',
        '0 FCFA de frais pour épargner. Le prix de votre projet est figé.',
        'Plafond actuel : plafond réglementaire de votre niveau. Il augmente avec votre pièce d’identité.',
        'Un problème ? « Être rappelé », réponse sous 72 h.',
        'Vous pouvez annuler et fermer votre compte à tout moment.',
      ];

  function speakSummary(): void {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(fivePoints.join(' '));
        u.lang = isEn ? 'en-GB' : 'fr-FR';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
    } catch { /* synthèse vocale absente */ }
  }

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
    <section aria-labelledby="terms-acceptance-title" className="mp-panel">
      <div className="mp-ph">
        <h2 id="terms-acceptance-title">{isEn ? 'New terms to accept' : 'Nouvelles conditions à accepter'}</h2>
        <ChoiceChip pressed={false} onClick={speakSummary}>{isEn ? 'Listen' : 'Écouter'}</ChoiceChip>
      </div>
      <p>
        {isEn
          ? `Our terms have changed (version ${version}). Read the essentials before starting a new project.`
          : `Nos conditions ont changé (version ${version}). Lisez l’essentiel avant de créer un nouveau projet.`}
      </p>
      <h3>{isEn ? 'The essentials in 5 points' : 'L’essentiel en 5 points'}</h3>
      <ul>
        {fivePoints.map((pt) => <li key={pt}>{pt}</li>)}
      </ul>
      {problem === null ? null : <ErrorState problem={problem} />}
      <label className="mp-chk">
        <input type="checkbox" checked={checked} onChange={(event) => { setChecked(event.currentTarget.checked); }} disabled={pending} />{' '}
        <span>{isEn ? 'I have read and accept the terms in force (required)' : 'J’ai lu et j’accepte les conditions en vigueur (obligatoire)'}</span>
      </label>
      <button
        type="button"
        role="switch"
        aria-checked={marketing}
        className="mp-chip"
        disabled={pending}
        onClick={() => { setMarketing((prev) => !prev); }}
      >
        {isEn ? 'Offer messages (optional)' : 'Messages d’offres (facultatif)'}
      </button>
      <Button type="button" disabled={!checked || pending} onClick={() => { void submit(); }}>
        {isEn ? 'Accept' : 'Accepter'}
      </Button>
    </section>
  );
}
