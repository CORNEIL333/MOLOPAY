'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Badge, Button, EmptyState, ErrorState, TextField, formatXaf } from '@achat/ui';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { CrmInteractionForm } from './crm-interaction-form';
import type { CrmFile, CrmPorts } from './crm-ports';
import { CrmTaskBoard } from './crm-task-board';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function when(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { timeZone: 'Africa/Douala' });
}

/**
 * Q5 / F-SUP-001 / F-BO-004 : fiche client 360° du support. Lecture motivée
 * et journalisée côté serveur ; le numéro n'apparaît que masqué. Les échanges
 * et tâches s'ajoutent, sans modification possible.
 */
export function CrmCustomer360({ ports, initialAccountId = '' }: { readonly ports: CrmPorts; readonly initialAccountId?: string }): ReactElement {
  const ids = { account: useId(), reason: useId(), identity: useId(), journal: useId(), agreements: useId() };
  const [accountId, setAccountId] = useState(initialAccountId);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<CrmFile | null>(null);
  const [errors, setErrors] = useState<{ readonly account?: string; readonly reason?: string }>({});
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const loading = useRef(false);

  async function load(id = accountId, motive = reason): Promise<void> {
    if (loading.current) return;
    const next = {
      ...(UUID.test(id) ? {} : { account: 'Identifiant de compte invalide.' }),
      ...(motive.trim().length >= 3 ? {} : { reason: 'Le motif de consultation est obligatoire (3 caractères au moins).' }),
    };
    setErrors(next);
    setProblem(null);
    if (Object.keys(next).length > 0) return;
    loading.current = true;
    setPending(true);
    try {
      const result = await ports.file(id, motive.trim());
      if (result.ok) {
        setFile(result.value);
      } else {
        setFile(null);
        setProblem(result.problem);
      }
    } catch {
      setFile(null);
      setProblem({ title: 'Fiche indisponible', detail: 'Connexion interrompue. Réessayez.', status: 0 });
    } finally {
      loading.current = false;
      setPending(false);
    }
  }

  function open(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load();
  }

  function refresh(): void {
    void load();
  }

  return (
    <section>
      <h1>Fiche client</h1>
      <p>Consultation motivée et journalisée. Le numéro n’est affiché que masqué ; aucun nom légal ni pièce d’identité.</p>
      <form onSubmit={open} noValidate>
        <TextField id={ids.account} label="Identifiant du compte client" autoComplete="off" value={accountId} error={errors.account} onChange={(event) => { setAccountId(event.target.value.trim()); }} />
        <TextField id={ids.reason} label="Motif de la consultation" value={reason} error={errors.reason} onChange={(event) => { setReason(event.target.value); }} />
        <Button type="submit" disabled={pending}>Ouvrir la fiche</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {file === null ? null : (
        <>
          <section aria-labelledby={ids.identity}>
            <h2 id={ids.identity}>Identité</h2>
            <p>
              Compte : <strong>{file.phoneMasked}</strong>{' '}
              <Badge tone={file.legalNameDeclared ? 'success' : 'neutral'}>{file.legalNameDeclared ? 'Nom déclaré' : 'Nom non déclaré'}</Badge>
            </p>
            <p>Client depuis le {when(file.memberSince)}.</p>
          </section>
          <section aria-labelledby={ids.agreements}>
            <h2 id={ids.agreements}>Accords récents</h2>
            {file.agreements.length === 0 ? <EmptyState title="Aucun accord" description="Ce client n’a pas encore d’accord." headingLevel={3} /> : (
              <ul>
                {file.agreements.map((agreement) => (
                  <li key={agreement.agreementId}>
                    <span>{agreement.model === 'SAVE_THEN_BUY' ? 'Épargner puis acheter' : agreement.model === 'FINANCED_PURCHASE' ? 'Achat financé' : 'Dépense planifiée'}</span>{' '}
                    <Badge tone="neutral">{agreement.status}</Badge>{' '}
                    <span>{formatXaf(agreement.targetXaf)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby={ids.journal}>
            <h2 id={ids.journal}>Journal des échanges</h2>
            {file.interactions.length === 0 ? <EmptyState title="Aucun échange" description="Aucun échange consigné pour ce client." headingLevel={3} /> : (
              <ol>
                {file.interactions.map((interaction) => (
                  <li key={interaction.interactionId}>
                    <p>
                      <strong>{when(interaction.occurredAt)}</strong>{' '}
                      <Badge tone="neutral">{interaction.channel}</Badge>{' '}
                      <span>{interaction.direction === 'INBOUND' ? 'client → support' : 'support → client'}</span>{' '}
                      <span>{interaction.actorId}</span>
                    </p>
                    <p>{interaction.summary}</p>
                    {interaction.outcome === null ? null : <p>Issue : {interaction.outcome}</p>}
                  </li>
                ))}
              </ol>
            )}
            <CrmInteractionForm submit={(input) => ports.recordInteraction(file.accountId, input).then((result) => { if (result.ok) refresh(); return result; })} />
          </section>
          <CrmTaskBoard
            tasks={file.tasks}
            create={(input) => ports.createTask(file.accountId, input)}
            transition={(taskId, kind, note) => ports.transitionTask(taskId, kind, note)}
            onChanged={refresh}
          />
        </>
      )}
    </section>
  );
}
