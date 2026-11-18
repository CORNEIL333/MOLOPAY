'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Screening = components['schemas']['SanctionsScreening'];
type Detail = components['schemas']['SanctionsScreeningDetail'];
type Decision = 'FALSE_POSITIVE' | 'CONFIRMED_MATCH';
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

/** Appels injectés (`browserSanctionsPorts`) ; droits et auteur ≠ examinateur vérifiés côté serveur et en base. */
export type SanctionsPorts = {
  readonly screen: (partnerId: string) => Promise<{ readonly ok: true; readonly screening: Screening } | Failure>;
  readonly review: (screeningId: string, decision: Decision, reason: string) => Promise<{ readonly ok: true } | Failure>;
  /** D74 : détail (nom filtré, noms listés) ; consultation motivée et journalisée côté serveur. */
  readonly detail: (screeningId: string, reason: string) => Promise<{ readonly ok: true; readonly detail: Detail } | Failure>;
};

const PARTNER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** REG-LBC-002 / D66 : filtrage d'un partenaire contre la liste ONU et examen motivé d'un rapprochement. */
export function SanctionsPanel({ ports }: { readonly ports: SanctionsPorts }): ReactElement {
  const ids = { partner: useId(), decision: useId(), reason: useId(), consultation: useId(), detailHeading: useId(), existing: useId() };
  const [existingId, setExistingId] = useState('');
  const [existingError, setExistingError] = useState<string | undefined>(undefined);
  const [consultation, setConsultation] = useState('');
  const [consultationError, setConsultationError] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<Detail | null>(null);
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
    setDetail(null);
    setReviewed(false);
    await guard(async () => {
      const result = await ports.screen(partnerId);
      if (result.ok) setScreening(result.screening);
      else setProblem(result.problem);
    });
  }

  async function showDetail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (screening === null) return;
    if (consultation.trim().length < 3) {
      setConsultationError('Le motif de consultation est obligatoire (3 caractères au moins).');
      return;
    }
    setConsultationError(undefined);
    await guard(async () => {
      const result = await ports.detail(screening.screeningId, consultation.trim());
      if (result.ok) setDetail(result.detail);
      else setProblem(result.problem);
    });
  }

  /** D75 : ouvre un filtrage déjà enregistré (ex. depuis la file de travail), détail sur motif. */
  async function openExisting(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const idValid = UUID.test(existingId);
    const reasonValid = consultation.trim().length >= 3;
    setExistingError(idValid ? undefined : 'Identifiant de filtrage invalide (UUID).');
    setConsultationError(reasonValid ? undefined : 'Le motif de consultation est obligatoire (3 caractères au moins).');
    if (!idValid || !reasonValid) return;
    await guard(async () => {
      const result = await ports.detail(existingId, consultation.trim());
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      setDetail(result.detail);
      setReviewed(result.detail.review !== null);
      setScreening({
        screeningId: result.detail.screeningId,
        partnerId: result.detail.subjectId,
        versionId: result.detail.screeningId,
        outcome: result.detail.outcome,
        matchedReferences: result.detail.matches.map((match) => match.reference),
      });
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
      {screening !== null ? null : (
        <form onSubmit={(event) => void openExisting(event)} noValidate>
          <h2>Examiner un filtrage existant</h2>
          <TextField id={ids.existing} label="Identifiant du filtrage" autoComplete="off" value={existingId} error={existingError} onChange={(event) => { setExistingId(event.target.value.trim()); }} />
          <TextField id={ids.consultation} label="Motif de la consultation" value={consultation} error={consultationError} onChange={(event) => { setConsultation(event.target.value); }} />
          <Button type="submit" disabled={pending}>Ouvrir le filtrage</Button>
        </form>
      )}
      {problem === null ? null : <ErrorState problem={problem} />}
      {screening === null ? null : (
        <p role="status">
          {screening.outcome === 'CLEAR'
            ? `Aucun rapprochement pour ${screening.partnerId}.`
            : `Rapprochement possible : ${screening.matchedReferences.join(', ')}. Examen requis par une autre personne de la Conformité.`}
        </p>
      )}
      {screening?.outcome !== 'POTENTIAL_MATCH' || detail !== null ? null : (
        <form onSubmit={(event) => void showDetail(event)} noValidate>
          <TextField id={ids.consultation} label="Motif de la consultation" value={consultation} error={consultationError} onChange={(event) => { setConsultation(event.target.value); }} />
          <Button type="submit" disabled={pending}>Voir le détail</Button>
        </form>
      )}
      {detail === null ? null : (
        <section aria-labelledby={ids.detailHeading}>
          <h2 id={ids.detailHeading}>Détail du filtrage</h2>
          <p>Nom filtré : <strong>{detail.normalizedName}</strong></p>
          <ul>
            {detail.matches.map((match) => (
              <li key={match.reference}>
                {match.reference} ({match.kind === 'ENTITY' ? 'entité' : 'personne'}, inscrite le {match.listedOn ?? '—'}) : {match.names.join(' ; ')}
              </li>
            ))}
          </ul>
        </section>
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
