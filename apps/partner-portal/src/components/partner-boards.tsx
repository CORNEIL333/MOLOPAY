'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, EmptyState, ErrorState, StatusPill } from '@achat/ui';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';

export type PartnerOrderRow = components['schemas']['PartnerOrder'];
export type PartnerPayoutRow = components['schemas']['PartnerPayout'];
type Loaded<T> = { readonly ok: true; readonly rows: readonly T[] } | { readonly ok: false; readonly problem: ProblemSummary };

/** Lectures injectées (`browserBoardPorts`) ; le serveur filtre par partenaire et par rôle. */
export type BoardPorts = {
  readonly loadOrders: () => Promise<Loaded<PartnerOrderRow>>;
  readonly loadPayouts: () => Promise<Loaded<PartnerPayoutRow>>;
};

function dateFormat(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeZone: 'Africa/Douala' });
}

function useLoad<T>(
  load: () => Promise<Loaded<T>>,
  failureTitle: string,
  failureDetail: string,
): { readonly rows: readonly T[] | null; readonly problem: ProblemSummary | null; readonly loading: boolean; readonly reload: () => void } {
  const [rows, setRows] = useState<readonly T[] | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setProblem(null);
    load()
      .then((result) => {
        if (!live) return;
        if (result.ok) setRows(result.rows);
        else setProblem(result.problem);
      })
      .catch(() => {
        if (live) setProblem({ title: failureTitle, detail: failureDetail });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [load, failureTitle, failureDetail, tick]);

  return { rows, problem, loading, reload };
}

/** F-PRT-004 / D63 : commandes du partenaire, sans donnée client ; export CSV proposé au gérant. */
export function OrdersBoard({ ports, role, locale = 'fr' }: { readonly ports: BoardPorts; readonly role: 'MANAGER' | 'SELLER'; readonly locale?: Locale }): ReactElement {
  const dictionary = getDictionary(locale);
  const t = dictionary.orders;
  const { rows, problem, loading, reload } = useLoad(ports.loadOrders, dictionary.common.loadFailed, dictionary.common.serviceDown);
  return (
    <section className="mp-page" aria-busy={loading}>
      <header className="mp-top">
        <h1>{t.title}</h1>
        <div className="mp-actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={reload}>{dictionary.common.refresh}</Button>
          {role === 'MANAGER' ? <a className="mp-chip" href="/v1/partner/orders/export" download>{t.export}</a> : null}
        </div>
      </header>
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="mp-panel mp-table-wrap">
          <table className="mp-table" aria-label={t.table}>
            <thead>
              <tr><th scope="col">{t.columns.offer}</th><th scope="col">{t.columns.status}</th><th scope="col" className="mp-num">{t.columns.amount}</th><th scope="col" className="mp-num">{t.columns.progress}</th><th scope="col">{t.columns.handover}</th></tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.orderId}>
                  <td><strong>{order.offerTitle ?? order.offerId ?? '—'}</strong></td>
                  <td><StatusPill tone={order.status === 'FUNDED' || order.status === 'HANDED_OVER' ? 'ok' : order.status === 'DISPUTED' || order.status === 'FROZEN' ? 'bad' : 'plain'}>{t.status[order.status]}</StatusPill></td>
                  <td className="mp-num"><AmountXaf amount={order.targetXaf} /></td>
                  <td className="mp-num">{`${Math.floor(order.progressBasisPoints / 100).toString()} %`}</td>
                  <td>{order.handedOverAt === null ? '—' : <time dateTime={order.handedOverAt}>{dateFormat(locale).format(new Date(order.handedOverAt))}</time>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** F-PRT-003/004 / D63 : règlements, réservés au gérant (le serveur refuse le vendeur). */
export function PayoutsBoard({ ports, locale = 'fr' }: { readonly ports: BoardPorts; readonly locale?: Locale }): ReactElement {
  const dictionary = getDictionary(locale);
  const t = dictionary.payouts;
  const { rows, problem, loading, reload } = useLoad(ports.loadPayouts, dictionary.common.loadFailed, dictionary.common.serviceDown);
  return (
    <section className="mp-page" aria-busy={loading}>
      <header className="mp-top">
        <div>
          <h1>{t.title}</h1>
          <p className="mp-sub">{t.commissionNotice}</p>
        </div>
        <div className="mp-actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={reload}>{dictionary.common.refresh}</Button>
        </div>
      </header>
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="mp-panel mp-table-wrap">
          <table className="mp-table" aria-label={t.table}>
            <thead>
              <tr><th scope="col">{t.columns.order}</th><th scope="col" className="mp-num">{t.columns.gross}</th><th scope="col" className="mp-num">{t.columns.commission}</th><th scope="col" className="mp-num">{t.columns.net}</th><th scope="col">{t.columns.status}</th><th scope="col">{t.columns.reference}</th></tr>
            </thead>
            <tbody>
              {rows.map((payout) => (
                <tr key={payout.payoutId}>
                  <td>{payout.agreementId}</td>
                  <td className="mp-num"><AmountXaf amount={payout.grossXaf} /></td>
                  <td className="mp-num"><AmountXaf amount={payout.commissionXaf} /></td>
                  <td className="mp-num"><AmountXaf amount={payout.netXaf} /></td>
                  <td><StatusPill tone={payout.status === 'EXECUTED' ? 'ok' : payout.status === 'REJECTED' || payout.status === 'EXECUTION_REJECTED' ? 'bad' : 'warn'}>{t.status[payout.status]}</StatusPill></td>
                  <td>{payout.bankReference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
