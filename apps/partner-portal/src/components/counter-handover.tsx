'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

/** Appels injectés : position du navigateur et route réelle de remise (`browserCounterPorts`). */
export type CounterHandoverPorts = {
  readonly locate: () => Promise<{ readonly latitude: number; readonly longitude: number }>;
  readonly confirm: (body: { readonly code: string; readonly latitude: string; readonly longitude: string }) => Promise<
    { readonly ok: true; readonly agreementId: string; readonly validatedAt: string } | { readonly ok: false; readonly problem: ProblemSummary }
  >;
};

// D45 : 10 caractères Crockford, tirets et espaces tolérés à la saisie.
const CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Coordonnée bornée et arrondie à 6 décimales (contrat de la route), jamais en notation exponentielle. */
function coordinate(value: number, limit: number): string | null {
  return Number.isFinite(value) && Math.abs(value) <= limit ? value.toFixed(6) : null;
}

/**
 * F-SET-001 / D63 : le vendeur saisit le code présenté par le client ; la
 * position du comptoir est jointe. Partenaire et vendeur viennent de la
 * session (serveur), jamais de ce formulaire.
 */
export function CounterHandover({ ports }: { readonly ports: CounterHandoverPorts }): ReactElement {
  const codeId = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [done, setDone] = useState<{ readonly agreementId: string; readonly validatedAt: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const compact = code.toUpperCase().replace(/[\s-]/g, '');
    if (!CODE.test(compact)) {
      setError('Le code de remise compte 10 caractères (lettres et chiffres).');
      return;
    }
    setError(undefined);
    setProblem(null);
    setDone(null);
    setPending(true);
    try {
      let position: { readonly latitude: string; readonly longitude: string } | null = null;
      try {
        const located = await ports.locate();
        const latitude = coordinate(located.latitude, 90);
        const longitude = coordinate(located.longitude, 180);
        position = latitude === null || longitude === null ? null : { latitude, longitude };
      } catch {
        position = null;
      }
      if (position === null) {
        setProblem({ title: 'Position indisponible', detail: 'Autorisez la localisation du comptoir : la remise doit être géolocalisée.' });
        return;
      }
      const result = await ports.confirm({ code: `${compact.slice(0, 5)}-${compact.slice(5)}`, ...position });
      if (result.ok) {
        setDone({ agreementId: result.agreementId, validatedAt: result.validatedAt });
        setCode('');
      } else {
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Remise non confirmée', detail: 'Le service ne répond pas. Ne remettez pas l’article ; réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Remise au comptoir</h1>
      {done === null ? null : <p role="status">Remise confirmée pour la commande {done.agreementId} à <time dateTime={done.validatedAt}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Douala' }).format(new Date(done.validatedAt))}</time>. Vous pouvez remettre l’article.</p>}
      {problem === null ? null : <ErrorState problem={problem} />}
      <form onSubmit={(event) => void submit(event)} noValidate>
        <TextField id={codeId} label="Code de remise du client" autoComplete="off" value={code} error={error} onChange={(event) => { setCode(event.target.value); }} />
        <Button type="submit" disabled={pending}>Confirmer la remise</Button>
      </form>
    </section>
  );
}
