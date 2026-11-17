'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, EmptyState, ErrorState } from '@achat/ui';
import { useEffect, useState, type ReactElement } from 'react';

export type PartnerOrderRow = components['schemas']['PartnerOrder'];
export type PartnerPayoutRow = components['schemas']['PartnerPayout'];
type Loaded<T> = { readonly ok: true; readonly rows: readonly T[] } | { readonly ok: false; readonly problem: ProblemSummary };

/** Lectures injectées (`browserBoardPorts`) ; le serveur filtre par partenaire et par rôle. */
export type BoardPorts = {
  readonly loadOrders: () => Promise<Loaded<PartnerOrderRow>>;
  readonly loadPayouts: () => Promise<Loaded<PartnerPayoutRow>>;
};

const ORDER_STATUS: Readonly<Record<PartnerOrderRow['status'], string>> = {
  ACTIVE: 'Épargne en cours',
  FUNDED: 'Financée à 100 %',
  HANDED_OVER: 'Remise',
  PAID_TO_BENEFICIARY: 'Réglée au bénéficiaire',
  CANCELLED_BY_CUSTOMER: 'Annulée par le client',
  DISPUTED: 'En litige',
  FROZEN: 'Gelée',
  REFUNDED: 'Remboursée',
  CLOSED: 'Clôturée',
};

const PAYOUT_STATUS: Readonly<Record<PartnerPayoutRow['status'], string>> = {
  PREPARED: 'Préparé',
  APPROVED: 'Approuvé',
  REJECTED: 'Refusé',
  INSTRUCTED: 'Ordre transmis',
  EXECUTED: 'Payé',
  EXECUTION_REJECTED: 'Paiement rejeté',
};

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Africa/Douala' });

function useLoad<T>(load: () => Promise<Loaded<T>>): { readonly rows: readonly T[] | null; readonly problem: ProblemSummary | null } {
  const [rows, setRows] = useState<readonly T[] | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((result) => {
        if (!live) return;
        if (result.ok) setRows(result.rows);
        else setProblem(result.problem);
      })
      .catch(() => {
        if (live) setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' });
      });
    return () => { live = false; };
  }, [load]);
  return { rows, problem };
}

/** F-PRT-004 / D63 : commandes du partenaire, sans donnée client ; export CSV proposé au gérant. */
export function OrdersBoard({ ports, role }: { readonly ports: BoardPorts; readonly role: 'MANAGER' | 'SELLER' }): ReactElement {
  const { rows, problem } = useLoad(ports.loadOrders);
  return (
    <section>
      <h1>Commandes</h1>
      {role === 'MANAGER' ? <p><a href="/v1/partner/orders/export" download>Exporter les commandes (CSV)</a></p> : null}
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title="Aucune commande pour le moment." description="Les commandes de vos clients apparaîtront ici dès leur premier versement." />
      ) : (
        <table aria-label="Commandes">
          <thead>
            <tr><th scope="col">Offre</th><th scope="col">État</th><th scope="col">Montant</th><th scope="col">Progression</th><th scope="col">Remise</th></tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.orderId}>
                <td>{order.offerTitle ?? order.offerId ?? '—'}</td>
                <td>{ORDER_STATUS[order.status]}</td>
                <td><AmountXaf amount={order.targetXaf} /></td>
                <td>{`${Math.floor(order.progressBasisPoints / 100).toString()} %`}</td>
                <td>{order.handedOverAt === null ? '—' : <time dateTime={order.handedOverAt}>{DATE.format(new Date(order.handedOverAt))}</time>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** F-PRT-003/004 / D63 : règlements, réservés au gérant (le serveur refuse le vendeur). */
export function PayoutsBoard({ ports }: { readonly ports: BoardPorts }): ReactElement {
  const { rows, problem } = useLoad(ports.loadPayouts);
  return (
    <section>
      <h1>Règlements</h1>
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title="Aucun règlement pour le moment." description="Les règlements apparaissent après chaque remise confirmée." />
      ) : (
        <table aria-label="Règlements">
          <thead>
            <tr><th scope="col">Commande</th><th scope="col">Brut</th><th scope="col">Commission</th><th scope="col">Net</th><th scope="col">État</th><th scope="col">Référence</th></tr>
          </thead>
          <tbody>
            {rows.map((payout) => (
              <tr key={payout.payoutId}>
                <td>{payout.agreementId}</td>
                <td><AmountXaf amount={payout.grossXaf} /></td>
                <td><AmountXaf amount={payout.commissionXaf} /></td>
                <td><AmountXaf amount={payout.netXaf} /></td>
                <td>{PAYOUT_STATUS[payout.status]}</td>
                <td>{payout.bankReference ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
