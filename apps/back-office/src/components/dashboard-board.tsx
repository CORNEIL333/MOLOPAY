'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, ErrorState, TextField } from '@achat/ui';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

type Dashboard = components['schemas']['BackofficeDashboard'];

/** Lecture injectée (`browserDashboardPorts`) : route réelle, motif inscrit à l'audit. */
export type DashboardPorts = {
  readonly load: (reason: string) => Promise<{ readonly ok: true; readonly board: Dashboard } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

const MODELS: Readonly<Record<Dashboard['agreements'][number]['model'], string>> = {
  SAVE_THEN_BUY: 'Épargne puis achat',
  FINANCED_PURCHASE: 'Achat financé',
  PLANNED_EXPENSE: 'Dépense planifiée',
};
const UNIVERSES: Readonly<Record<string, string>> = { ESSENTIALS: 'Essentiels', TECHNOLOGY: 'Technologie', HOUSING: 'Logement', MOBILITY: 'Mobilité' };
const CITIES: Readonly<Record<string, string>> = { douala: 'Douala', yaounde: 'Yaoundé' };
const SETTLEMENT_STATES: Readonly<Record<Dashboard['settlements'][number]['state'], string>> = {
  PREPARED: 'Préparé',
  APPROVED: 'Approuvé',
  REJECTED: 'Refusé',
  INSTRUCTED: 'Instruit',
  EXECUTED: 'Exécuté',
  EXECUTION_REJECTED: 'Exécution rejetée',
};

function cities(value: string): string {
  return value === '' ? '—' : value.split('+').map((city) => CITIES[city] ?? city).join(', ');
}

/** F-BO-003 / D65 : tableau de bord agrégé, consultation motivée (F-BO-004). */
export function DashboardBoard({ ports }: { readonly ports: DashboardPorts }): ReactElement {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [pending, setPending] = useState(false);

  async function load(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError('Indiquez le motif de la consultation (3 caractères au moins).');
      return;
    }
    setError(undefined);
    setProblem(null);
    setPending(true);
    try {
      const result = await ports.load(reason.trim());
      if (result.ok) {
        setBoard(result.board);
      } else {
        setBoard(null);
        setProblem(result.problem);
      }
    } catch {
      setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mp-page">
      <header className="mp-top">
        <div><h1>Tableau de bord</h1><p className="mp-sub">Vue d’ensemble agrégée issue du grand livre et des accords.</p></div>
      </header>
      <form className="mp-panel mp-form" onSubmit={(event) => void load(event)} noValidate>
        <TextField id={reasonId} label="Motif de la consultation" value={reason} error={error} onChange={(event) => { setReason(event.target.value); }} />
        <Button type="submit" disabled={pending}>Afficher le tableau de bord</Button>
      </form>
      {problem === null ? null : <ErrorState problem={problem} />}
      {board === null ? null : (
        <>
          <p className="mp-banner mp-banner--audit">Instantané du <time dateTime={board.asOf}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Douala' }).format(new Date(board.asOf))}</time>.</p>
          <ul className="mp-kpis" aria-label="Compteurs">
            <li className="mp-kpi mp-kpi--hl"><span className="mp-kpi__label">Remises</span><span className="mp-kpi__val">{`Remises : ${board.handovers.toString()}`}</span></li>
            <li className="mp-kpi"><span className="mp-kpi__label">Litiges</span><span className="mp-kpi__val">{`Litiges ouverts : ${board.openDisputes.toString()}`}</span></li>
            <li className="mp-kpi"><span className="mp-kpi__label">Réclamations</span><span className="mp-kpi__val">{`Réclamations ouvertes : ${board.openComplaints.toString()}`}</span></li>
            <li className="mp-kpi"><span className="mp-kpi__label">Risque</span><span className="mp-kpi__val">{`Alertes de fraude ouvertes : ${board.openRiskAlerts.toString()}`}</span></li>
          </ul>
          <div className="mp-panel mp-table-wrap">
            <table className="mp-table" aria-label="Accords">
              <thead>
                <tr><th scope="col">Modèle</th><th scope="col">Univers</th><th scope="col">Villes</th><th scope="col">État</th><th scope="col" className="mp-num">Nombre</th><th scope="col" className="mp-num">Montant cible</th><th scope="col" className="mp-num">Fonds confirmés</th></tr>
              </thead>
              <tbody>
                {board.agreements.map((row) => (
                  <tr key={`${row.model}-${row.universe ?? ''}-${row.cities}-${row.status}`}>
                    <td>{MODELS[row.model]}</td>
                    <td>{row.universe === null ? '—' : (UNIVERSES[row.universe] ?? row.universe)}</td>
                    <td>{cities(row.cities)}</td>
                    <td>{row.status}</td>
                    <td className="mp-num">{row.count}</td>
                    <td className="mp-num"><AmountXaf amount={row.targetXaf} /></td>
                    <td className="mp-num"><AmountXaf amount={row.confirmedFundsXaf} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mp-panel mp-table-wrap">
            <table className="mp-table" aria-label="Règlements marchands">
              <thead>
                <tr><th scope="col">État</th><th scope="col" className="mp-num">Nombre</th><th scope="col" className="mp-num">Net</th></tr>
              </thead>
              <tbody>
                {board.settlements.map((row) => (
                  <tr key={row.state}>
                    <td>{SETTLEMENT_STATES[row.state]}</td>
                    <td className="mp-num">{row.count}</td>
                    <td className="mp-num"><AmountXaf amount={row.netXaf} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
