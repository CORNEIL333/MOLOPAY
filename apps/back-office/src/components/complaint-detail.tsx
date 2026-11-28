'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Complaint = components['schemas']['ComplaintDetail'];

/** Lecture injectée (`browserComplaintPorts`) : route réelle, motif inscrit à l'audit (F-BO-004). */
export type ComplaintPorts = {
  readonly load: (complaintId: string, reason: string) => Promise<{ readonly ok: true; readonly complaint: Complaint } | { readonly ok: false; readonly problem: ProblemSummary }>;
  /** C6 / D56 : ouverture d'un litige (support N2) ; la levée revient à une autre personne (file de travail). */
  readonly openDispute: (complaintId: string) => Promise<{ readonly ok: true; readonly disputeId: string } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHANNELS: Readonly<Record<Complaint['channel'], string>> = { APP: 'Application', USSD_CALLBACK: 'Rappel USSD', PHONE: 'Téléphone' };
const REASONS: Readonly<Record<string, string>> = {
  PAYMENT_NOT_RECEIVED: 'Versement non reçu',
  HANDOVER_REFUSED: 'Remise refusée',
  OFFER_MISMATCH: 'Article non conforme',
  OTHER: 'Autre',
};

/** F-SUP-001 / D73 : détail d'une réclamation, consultation motivée. */
export function ComplaintDetail({ ports, initialComplaintId = '' }: { readonly ports: ComplaintPorts; readonly initialComplaintId?: string }): ReactElement {
  const ids = { complaint: useId(), reason: useId(), heading: useId() };
  const [complaintId, setComplaintId] = useState(initialComplaintId);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ readonly complaint?: string; readonly reason?: string }>({});
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [pending, setPending] = useState(false);

  async function openDispute(): Promise<void> {
    if (complaint === null) return;
    setProblem(null);
    setPending(true);
    try {
      const result = await ports.openDispute(complaint.complaintId);
      if (result.ok) setComplaint({ ...complaint, openDispute: true });
      else setProblem(result.problem);
    } catch {
      setProblem({ title: 'Ouverture du litige non confirmée', detail: 'Le service ne répond pas. Rechargez la réclamation avant de réessayer.' });
    } finally {
      setPending(false);
    }
  }

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const next = {
      ...(UUID.test(complaintId) ? {} : { complaint: 'Identifiant invalide (UUID).' }),
      ...(reason.trim().length >= 3 ? {} : { reason: 'Indiquez le motif de la consultation (3 caractères au moins).' }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setProblem(null);
    setComplaint(null);
    setPending(true);
    try {
      const result = await ports.load(complaintId, reason.trim());
      if (result.ok) setComplaint(result.complaint);
      else setProblem(result.problem);
    } catch {
      setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Réclamation</h1>
      <form onSubmit={(event) => void load(event)} noValidate>
        <TextField id={ids.complaint} label="Identifiant de la réclamation" autoComplete="off" value={complaintId} error={errors.complaint} onChange={(event) => { setComplaintId(event.target.value.trim()); }} />
        <TextField id={ids.reason} label="Motif de la consultation" value={reason} error={errors.reason} onChange={(event) => { setReason(event.target.value); }} />
        <Button type="submit" disabled={pending}>Consulter</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {complaint === null ? null : (
        <section aria-labelledby={ids.heading}>
          <h2 id={ids.heading}>Réclamation {complaint.reference}</h2>
          <dl>
            <div><dt>Canal</dt><dd>{CHANNELS[complaint.channel]}</dd></div>
            <div><dt>Reçue le</dt><dd><time dateTime={complaint.receivedAt}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Douala' }).format(new Date(complaint.receivedAt))}</time></dd></div>
            <div><dt>Objectif</dt><dd>{complaint.agreementId === null ? '—' : <a href={`/objectifs?objectif=${encodeURIComponent(complaint.agreementId)}`} aria-label={`Historique de l’objectif ${complaint.agreementId}`}>{complaint.agreementId}</a>}</dd></div>
            <div><dt>Motif</dt><dd>{complaint.reason === null ? '—' : (REASONS[complaint.reason] ?? complaint.reason)}</dd></div>
            <div><dt>Description</dt><dd>{complaint.details ?? 'Aucune description saisie'}</dd></div>
          </dl>
          <p>Litige ouvert : {complaint.openDispute ? 'oui' : 'non'} · Close : {complaint.closed ? 'oui' : 'non'}</p>
          {complaint.openDispute || complaint.closed || complaint.agreementId === null ? null : (
            <Button variant="danger" disabled={pending} onClick={() => void openDispute()}>Ouvrir un litige</Button>
          )}
        </section>
      )}
    </section>
  );
}
