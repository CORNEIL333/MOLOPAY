'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Badge, Button, EmptyState, ErrorState, TextArea, TextField } from '@achat/ui';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { CrmResult, CrmTaskInput, CrmTaskView, CrmTransition } from './crm-ports';

const PRIORITIES: readonly (readonly [string, string])[] = [
  ['LOW', 'Basse'],
  ['NORMAL', 'Normale'],
  ['HIGH', 'Haute'],
];

const STATUS: Readonly<Record<CrmTaskView['status'], { readonly label: string; readonly tone: 'neutral' | 'success' | 'danger' }>> = {
  OPEN: { label: 'Ouverte', tone: 'neutral' },
  COMPLETED: { label: 'Terminée', tone: 'success' },
  CANCELLED: { label: 'Annulée', tone: 'neutral' },
};

function localNow(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${now.getFullYear().toString()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function dateLabel(value: string | null): string {
  return value === null ? 'sans échéance' : `échéance ${new Date(value).toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })}`;
}

/** Clôture d'une tâche ouverte : motif obligatoire, une seule transition. */
function CloseTask({ taskId, transition, onDone }: { readonly taskId: string; readonly transition: (taskId: string, kind: CrmTransition, note: string) => Promise<CrmResult<null>>; readonly onDone: () => void }): ReactElement {
  const ids = { note: useId() };
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function close(kind: CrmTransition): Promise<void> {
    if (sending.current) return;
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setError('Le motif est obligatoire (3 caractères au moins).');
      return;
    }
    setError(undefined);
    setProblem(null);
    sending.current = true;
    setPending(true);
    try {
      const result = await transition(taskId, kind, trimmed);
      if (result.ok) {
        setNote('');
        onDone();
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Transition non enregistrée', detail: 'Connexion interrompue. Vérifiez l’état de la tâche avant de réessayer.', status: 0 });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <div>
      <TextField id={ids.note} label="Motif de clôture" value={note} error={error} onChange={(event) => { setNote(event.target.value); }} />
      <Button type="button" disabled={pending} onClick={() => { void close('COMPLETED'); }}>Terminer la tâche</Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => { void close('CANCELLED'); }}>Annuler la tâche</Button>
      {problem === null ? null : <ErrorState problem={problem} />}
    </div>
  );
}

/**
 * Q5 / F-SUP-001 : tâches de suivi d'un client — création, liste avec état
 * dérivé des événements, clôture motivée. Une tâche close ne se rejoue pas.
 */
export function CrmTaskBoard({ tasks, create, transition, onChanged }: {
  readonly tasks: readonly CrmTaskView[];
  readonly create: (input: CrmTaskInput) => Promise<CrmResult<null>>;
  readonly transition: (taskId: string, kind: CrmTransition, note: string) => Promise<CrmResult<null>>;
  readonly onChanged: () => void;
}): ReactElement {
  const ids = { section: useId(), title: useId(), assignee: useId(), priority: useId(), dueAt: useId(), details: useId() };
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [dueAt, setDueAt] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<{ readonly title?: string; readonly assignee?: string }>({});
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending.current) return;
    const next = {
      ...(title.trim().length >= 3 ? {} : { title: 'L’intitulé est obligatoire (3 caractères au moins).' }),
      ...(assignee.trim().length > 0 ? {} : { assignee: 'Le destinataire est obligatoire.' }),
    };
    setError(next);
    setProblem(null);
    if (Object.keys(next).length > 0) return;
    sending.current = true;
    setPending(true);
    try {
      const result = await create({
        title: title.trim(),
        details: details.trim() === '' ? null : details.trim(),
        priority,
        assignee: assignee.trim(),
        dueAt: dueAt === '' ? null : new Date(dueAt).toISOString(),
      });
      if (result.ok) {
        setTitle('');
        setDetails('');
        setDueAt('');
        onChanged();
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Tâche non créée', detail: 'Connexion interrompue. Vérifiez la liste avant de réessayer.', status: 0 });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={ids.section}>
      <h3 id={ids.section}>Tâches de suivi</h3>
      {tasks.length === 0 ? <EmptyState title="Aucune tâche" description="Aucune tâche de suivi pour ce client." headingLevel={3} /> : (
        <ul>
          {tasks.map((task) => (
            <li key={task.taskId}>
              <article aria-labelledby={`task-${task.taskId}`}>
                <h4 id={`task-${task.taskId}`}>{task.title}</h4>
                <p>
                  <Badge tone={STATUS[task.status].tone}>{STATUS[task.status].label}</Badge>{' '}
                  <span>{task.assigneeId}</span>{' '}
                  <span>{dateLabel(task.dueAt)}</span>{' '}
                  <span>{`priorité ${PRIORITIES.find(([value]) => value === task.priority)?.[1] ?? task.priority}`}</span>
                </p>
                {task.details === null ? null : <p>{task.details}</p>}
                {task.status === 'OPEN' ? <CloseTask taskId={task.taskId} transition={transition} onDone={onChanged} /> : null}
              </article>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => { void submit(event); }} noValidate>
        <TextField id={ids.title} label="Intitulé de la tâche" value={title} error={error.title} onChange={(event) => { setTitle(event.target.value); }} />
        <TextField id={ids.assignee} label="Destinataire (identifiant de l’agent)" autoComplete="off" value={assignee} error={error.assignee} onChange={(event) => { setAssignee(event.target.value); }} />
        <label htmlFor={ids.priority}>Priorité</label>
        <select id={ids.priority} value={priority} onChange={(event) => { setPriority(event.target.value); }}>
          {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={ids.dueAt}>Échéance (facultatif)</label>
        <input id={ids.dueAt} type="datetime-local" value={dueAt} min={localNow()} onChange={(event) => { setDueAt(event.target.value); }} />
        <TextArea id={ids.details} label="Détails (facultatif)" value={details} onChange={(event) => { setDetails(event.target.value); }} />
        <Button type="submit" disabled={pending}>Créer la tâche</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
    </section>
  );
}
