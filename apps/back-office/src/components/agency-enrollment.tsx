'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Enrollment = components['schemas']['AgencyEnrollment'];
type Request = components['schemas']['AgencyEnrollmentRequest'];
type Failure = { readonly ok: false; readonly problem: ProblemSummary };

export type AgencyEnrollmentPorts = {
  readonly issue: (input: Request) => Promise<{ readonly ok: true; readonly enrollment: Enrollment } | Failure>;
};

const PHONE = /^\+[1-9][0-9]{7,14}$/;
const TIME = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Africa/Douala' });

/**
 * C13 / F-ACC-001 : inscription en agence, sans SMS. L'agent vérifie EN
 * PERSONNE la pièce d'identité du client et que le téléphone présenté est le
 * sien, puis remet le code (valable 5 minutes) au client, qui termine
 * l'inscription sur son appareil. Le code n'est affiché qu'une fois.
 */
export function AgencyEnrollment({ ports }: { readonly ports: AgencyEnrollmentPorts }): ReactElement {
  const ids = { phone: useId(), document: useId(), city: useId(), check: useId() };
  const [phone, setPhone] = useState('+237');
  const [documentType, setDocumentType] = useState<Request['documentType']>('CNI');
  const [cityId, setCityId] = useState<Request['cityId']>('douala');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<Enrollment | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const value = phone.replace(/\s/g, '');
    if (!PHONE.test(value)) { setError('Numéro international attendu (ex. +237690000000).'); return; }
    if (!checked) { setError('Confirmez avoir vérifié la pièce et le téléphone en présence du client.'); return; }
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const result = await ports.issue({ phone: value, documentType, cityId });
      if (result.ok) {
        setIssued(result.enrollment);
        setChecked(false);
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Code non émis', detail: 'Connexion interrompue. Ne réessayez qu’après avoir vérifié qu’aucun code n’a été remis.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Inscription en agence</h1>
      <p>Sans SMS : vérifiez en personne la pièce d’identité du client et que le téléphone présenté est le sien, puis remettez-lui le code. Il termine l’inscription sur son téléphone (code, PIN, conditions). Ne notez pas le numéro de la pièce.</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      {issued === null ? null : (
        <div role="status">
          {issued.code === null
            ? <p>Ce code a déjà été affiché. Émettez-en un nouveau si le client ne l’a pas reçu.</p>
            : (
              <>
                <p>Code à remettre au client, valable jusqu’à {TIME.format(new Date(issued.expiresAt))} :</p>
                <p style={{ fontSize: '2.5rem', letterSpacing: '0.3em', fontWeight: 700 }} aria-label={`Code ${issued.code.split('').join(' ')}`}>{issued.code}</p>
              </>
            )}
          <Button type="button" variant="secondary" onClick={() => { setIssued(null); setPhone('+237'); }}>Client suivant</Button>
        </div>
      )}
      {issued !== null ? null : (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <TextField id={ids.phone} label="Téléphone du client" inputMode="tel" autoComplete="off" value={phone} error={error} onChange={(event) => { setPhone(event.target.value); }} />
          <label htmlFor={ids.document}>Pièce présentée</label>
          <select id={ids.document} value={documentType} onChange={(event) => { setDocumentType(event.target.value as Request['documentType']); }}>
            <option value="CNI">Carte nationale d’identité</option>
            <option value="PASSPORT">Passeport</option>
            <option value="RESIDENCE_PERMIT">Carte de séjour</option>
          </select>
          <label htmlFor={ids.city}>Agence</label>
          <select id={ids.city} value={cityId} onChange={(event) => { setCityId(event.target.value as Request['cityId']); }}>
            <option value="douala">Douala</option>
            <option value="yaounde">Yaoundé</option>
          </select>
          <p>
            <input id={ids.check} type="checkbox" checked={checked} onChange={(event) => { setChecked(event.currentTarget.checked); }} />{' '}
            <label htmlFor={ids.check}>J’ai vérifié la pièce et le téléphone en présence du client</label>
          </p>
          <Button type="submit" disabled={pending}>Émettre le code</Button>
        </form>
      )}
    </section>
  );
}
