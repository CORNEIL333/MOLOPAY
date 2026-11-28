'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Report = components['schemas']['ProductKpis'];
type Cell = components['schemas']['KpiCell'];

/** Lecture injectée (`browserProductKpisPorts`) : route réelle, motif inscrit à l'audit. */
export type ProductKpisPorts = {
  readonly load: (input: { readonly from: string; readonly to: string; readonly reason: string }) => Promise<{ readonly ok: true; readonly report: Report } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const KEYS: Readonly<Record<string, string>> = {
  ESSENTIALS: 'Essentiels',
  TECHNOLOGY: 'Technologie',
  HOUSING: 'Logement',
  MOBILITY: 'Mobilité',
  PLANNED_EXPENSE_HORS_UNIVERS: 'Dépense planifiée (hors univers)',
  douala: 'Douala',
  yaounde: 'Yaoundé',
  NON_ATTRIBUEE: 'Non attribuée',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function decimal(value: string): string {
  return value.replace('.', ',');
}

function days(from: string, to: string): number | null {
  if (!DATE.test(from) || !DATE.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 86_400_000;
}

function Breakdown({ label, cells, withAmount, empty }: { readonly label: string; readonly cells: readonly Cell[]; readonly withAmount: boolean; readonly empty: string }): ReactElement {
  if (cells.length === 0) return <p>{empty}</p>;
  return (
    <div className="mp-panel mp-table-wrap">
      <table className="mp-table" aria-label={label}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col" className="mp-num">Objectifs</th>
            {withAmount ? <th scope="col" className="mp-num">Montant</th> : null}
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => (
            <tr key={cell.key}>
              <th scope="row">{KEYS[cell.key] ?? cell.key}</th>
              <td className="mp-num">{cell.goals === '<5' ? 'moins de 5' : cell.goals}</td>
              {withAmount ? <td className="mp-num">{cell.amountXaf === undefined || cell.amountXaf === '<5' ? 'masqué' : <AmountXaf amount={cell.amountXaf} />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * F-REP-002 : indicateurs produits (définitions écrites :
 * `docs/04_annexes/DEFINITIONS_INDICATEURS.md`). Période en dates de Douala,
 * fin exclue, au plus 366 jours ; consultation motivée (F-BO-004). Les cases
 * de moins de 5 objectifs restent masquées.
 */
export function ProductKpisBoard({ ports }: { readonly ports: ProductKpisPorts }): ReactElement {
  const ids = { from: useId(), to: useId(), reason: useId() };
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const span = days(from, to);
    if (span === null) {
      setFormError('Indiquez les deux dates au format AAAA-MM-JJ.');
      return;
    }
    if (span <= 0 || span > MAX_DAYS) {
      setFormError(`La période doit couvrir de 1 à ${MAX_DAYS} jours (jour de fin exclu).`);
      return;
    }
    if (reason.trim().length < 3) {
      setFormError('Indiquez le motif de la consultation (3 caractères au moins).');
      return;
    }
    setFormError(null);
    setProblem(null);
    setPending(true);
    try {
      const result = await ports.load({ from, to, reason: reason.trim() });
      if (result.ok) {
        setReport(result.report);
      } else {
        setReport(null);
        setProblem(result.problem);
      }
    } catch {
      setReport(null);
      setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mp-page">
      <header className="mp-top"><h1>Indicateurs produits</h1></header>
      <form className="mp-panel mp-form" onSubmit={(event) => void load(event)} noValidate>
        <TextField id={ids.from} label="Premier jour (inclus)" hint="AAAA-MM-JJ, heure de Douala" value={from} onChange={(event) => { setFrom(event.target.value); }} />
        <TextField id={ids.to} label="Jour de fin (exclu)" hint="AAAA-MM-JJ, au plus 366 jours après le premier" value={to} onChange={(event) => { setTo(event.target.value); }} />
        <TextField id={ids.reason} label="Motif de la consultation" value={reason} onChange={(event) => { setReason(event.target.value); }} />
        {formError === null ? null : <p role="alert">{formError}</p>}
        <Button type="submit" disabled={pending}>Afficher les indicateurs</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {report === null ? null : (
        <>
          <p className="mp-banner mp-banner--audit">{`Consultation journalisée. Motif : ${reason.trim()}. Visible par l’audit.`}</p>
          <section className="mp-panel">
            <h2>Totaux de la période</h2>
            <ul aria-label="Totaux de la période">
              <li>Volume confirmé : <AmountXaf amount={report.volume.totalXaf} /></li>
              <li>Objectifs ouverts à la fin de la période : {report.openGoals.total}</li>
              <li>
                Objectifs à 100 % :{' '}
                {report.completion.ratePercent === null
                  ? 'non calculé (aucun objectif activé)'
                  : `${decimal(report.completion.ratePercent)} % (${report.completion.funded} sur ${report.completion.activated} activés)`}
              </li>
              <li>
                Délai de remise :{' '}
                {report.handoverDelay.medianDays === null || report.handoverDelay.p90Days === null
                  ? 'aucune remise'
                  : `médiane ${decimal(report.handoverDelay.medianDays)} j, 90ᵉ centile ${decimal(report.handoverDelay.p90Days)} j (${report.handoverDelay.count} remise${report.handoverDelay.count > 1 ? 's' : ''})`}
              </li>
              <li>
                Marge de commission : <AmountXaf amount={report.commissionMargin.totalXaf} /> sur {report.commissionMargin.count} commande{report.commissionMargin.count > 1 ? 's' : ''}
                {report.commissionMargin.averageXaf === null ? null : <>, moyenne <AmountXaf amount={report.commissionMargin.averageXaf} /></>}
              </li>
              <li>Impayés B : sans objet (modèle B non ouvert)</li>
            </ul>
          </section>
          <h2>Ventilations</h2>
          <Breakdown label="Volume par univers" cells={report.volume.byUniverse} withAmount empty="Aucun versement confirmé sur la période." />
          <Breakdown label="Volume par ville" cells={report.volume.byCity} withAmount empty="Aucun versement confirmé sur la période." />
          <Breakdown label="Objectifs ouverts par univers" cells={report.openGoals.byUniverse} withAmount={false} empty="Aucun objectif ouvert." />
          <Breakdown label="Objectifs ouverts par ville" cells={report.openGoals.byCity} withAmount={false} empty="Aucun objectif ouvert attribuable à une ville." />
        </>
      )}
    </section>
  );
}
