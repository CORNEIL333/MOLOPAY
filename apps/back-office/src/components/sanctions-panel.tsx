'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Screening = components['schemas']['SanctionsScreening'];
type Decision = 'FALSE_POSITIVE' | 'CONFIRMED_MATCH';
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

/** Appels injectés (`browserSanctionsPorts`) ; droits et auteur ≠ examinateur vérifiés côté serveur et en base. */
export type SanctionsPorts = {
  readonly screen: (partnerId: string) => Promise<{ readonly ok: true; readonly screening: Screening } | Failure>;
  readonly review: (screeningId: string, decision: Decision, reason: string) => Promise<{ readonly ok: true } | Failure>;
};

const PARTNER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** REG-LBC-002 / D66 : filtrage d'un partenaire contre la liste ONU et examen motivé d'un rapprochement. */
export function SanctionsPanel({ ports }: { readonly ports: SanctionsPorts }): ReactElement {
  const ids = { partner: useId(), decision: useId(), reason: useId() };
  const [partnerId, setPartnerId] = useState('');
  const [partnerError, setPartnerError] = useState<string | undefined>(undefined);
  const [screening, setScreening] = useState<Screening | null>(null);
  const [decision, setDecision] = useState<Decision>('FALSE_POSITIVE');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [reviewed, setReviewed] = useState(false);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);

  async function guard(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setProblem(null);
    try {
      await action();
    } catch {
      setProblem({ title: 'Action impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  async function screenPartner(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!PARTNER_ID.test(partnerId)) {
      setPartnerError('Identifiant invalide (lettres, chiffres, tiret, souligné).');
      return;
    }
    setPartnerError(undefined);
    setScreening(null);
    setReviewed(false);
    await guard(async () => {
      const result = await ports.screen(partnerId);
      if (result.ok) setScreening(result.screening);
      else setProblem(result.problem);
    });
  }

  async function review(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (screening === null) return;
    if (reason.trim().length < 3) {
      setReasonError('Le motif est obligatoire (3 caractères au moins).');
      return;
    }
    setReasonError(undefined);
    await guard(async () => {
      const result = await ports.review(screening.screeningId, decision, reason.trim());
      if (result.ok) setReviewed(true);
      else setProblem(result.problem);
    });
  }

  return (
    <section>
      <h1>Filtrage sanctions (liste ONU)</h1>
      <form onSubmit={(event) => void screenPartner(event)} noValidate>
        <TextField id={ids.partner} label="Identifiant du partenaire" autoComplete="off" value={partnerId} error={partnerError} onChange={(event) => { setPartnerId(event.target.value.trim()); }} />
        <Button type="submit" disabled={pending}>Filtrer contre la liste ONU</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {screening === null ? null : (
        <p role="status">
          {screening.outcome === 'CLEAR'
            ? `Aucun rapprochement pour ${screening.partnerId}.`
            : `Rapprochement possible : ${screening.matchedReferences.join(', ')}. Examen requis par une autre personne de la Conformité.`}
        </p>
      )}
      {screening?.outcome !== 'POTENTIAL_MATCH' || reviewed ? null : (
        <form onSubmit={(event) => void review(event)} noValidate>
          <h2>Examen du rapprochement</h2>
          <div className="achat-field">
            <label className="achat-field__label" htmlFor={ids.decision}>Décision</label>
            <select id={ids.decision} className="achat-field__input" value={decision} onChange={(event) => { setDecision(event.target.value === 'CONFIRMED_MATCH' ? 'CONFIRMED_MATCH' : 'FALSE_POSITIVE'); }}>
              <option value="FALSE_POSITIVE">Faux positif (homonyme)</option>
              <option value="CONFIRMED_MATCH">Correspondance confirmée</option>
            </select>
          </div>
          <TextField id={ids.reason} label="Motif de l’examen" value={reason} error={reasonError} onChange={(event) => { setReason(event.target.value); }} />
          <Button type="submit" disabled={pending}>Enregistrer l’examen</Button>
        </form>
      )}
      {reviewed ? <p>Examen enregistré.</p> : null}
    </section>
  );
}
