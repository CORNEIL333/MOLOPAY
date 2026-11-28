'use client';

import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, Button, EmptyState, ErrorState, StatusPill, sumCanonicalXaf } from '@achat/ui';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';
import type { PartnerOfferRow } from './offers-board';
import type { PartnerOrderRow, PartnerPayoutRow } from './partner-boards';

type Loaded<T> = { readonly ok: true; readonly rows: readonly T[] } | { readonly ok: false; readonly problem: ProblemSummary };
export type ManagerDashboardPorts = {
  readonly loadOrders: () => Promise<Loaded<PartnerOrderRow>>;
  readonly loadPayouts: () => Promise<Loaded<PartnerPayoutRow>>;
  readonly loadOffers: () => Promise<Loaded<PartnerOfferRow>>;
};
type Snapshot = { readonly orders: readonly PartnerOrderRow[]; readonly payouts: readonly PartnerPayoutRow[]; readonly offers: readonly PartnerOfferRow[] };
const BANDS: readonly (readonly [string, number, number])[] = [['0 – 24 %', 0, 2499], ['25 – 49 %', 2500, 4999], ['50 – 74 %', 5000, 7499], ['75 – 99 %', 7500, 9999]];

/** 09_… § 4.2 : tableau de bord du gérant à plat (aucun verre ni fond liquide, aucune donnée fictive). */
export function ManagerDashboard({ ports, locale = 'fr' }: { readonly ports: ManagerDashboardPorts; readonly locale?: Locale }): ReactElement {
  const dict = getDictionary(locale);
  const d = dict.dashboard;
  const [data, setData] = useState<Snapshot | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'ready' | 'done'>('ready');
  const [tick, setTick] = useState(0);
  const reload = useCallback((): void => { setTick((n) => n + 1); }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setProblem(null);
    Promise.all([ports.loadOrders(), ports.loadPayouts(), ports.loadOffers()])
      .then(([o, p, f]) => {
        if (!live) return;
        if (!o.ok) { setProblem(o.problem); return; }
        if (!p.ok) { setProblem(p.problem); return; }
        if (!f.ok) { setProblem(f.problem); return; }
        setData({ orders: o.rows, payouts: p.rows, offers: f.rows });
      })
      .catch(() => { if (live) setProblem({ title: dict.common.loadFailed, detail: dict.common.serviceDown }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [ports, dict, tick]);

  const readyOrders = data?.orders.filter((o) => o.status === 'FUNDED') ?? [];
  const doneOrders = data?.orders.filter((o) => o.status === 'HANDED_OVER') ?? [];
  const activeOrders = data?.orders.filter((o) => o.status === 'ACTIVE') ?? [];
  const pendingPayouts = data?.payouts.filter((p) => p.status === 'PREPARED' || p.status === 'APPROVED' || p.status === 'INSTRUCTED') ?? [];
  const netPayoutXaf = sumCanonicalXaf((data?.payouts ?? []).filter((p) => p.status !== 'REJECTED' && p.status !== 'EXECUTION_REJECTED').map((p) => p.netXaf));
  const lowStockOffers = data?.offers.filter((f) => !f.publiclyVisible || (f.availabilityKind === 'IN_STOCK' && (f.availableUnits ?? 0) <= 2)) ?? [];
  const totalTracked = Math.max(1, activeOrders.length + readyOrders.length);
  const shownOrders = tab === 'ready' ? readyOrders : doneOrders;
  const dateFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeZone: 'Africa/Douala' });

  return (
    <section className="mp-page" aria-busy={loading}>
      <header className="mp-top">
        <div><h1>{d.title}</h1><p className="mp-sub">{d.subtitle}</p></div>
        <div className="mp-actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={reload}>{dict.common.refresh}</Button>
          <a className="mp-chip" href="/v1/partner/orders/export" download>{dict.orders.export}</a>
        </div>
      </header>
      {problem === null ? null : <ErrorState problem={problem} />}
      {data === null || problem !== null ? null : (
        <>
          <ul className="mp-kpis">
            <li className="mp-kpi mp-kpi--hl"><span className="mp-kpi__label">{d.kpiReady}</span><span className="mp-kpi__val">{readyOrders.length}</span><span className="mp-kpi__hint">{d.kpiReadyHint}</span></li>
            <li className="mp-kpi"><span className="mp-kpi__label">{d.kpiActive}</span><span className="mp-kpi__val">{activeOrders.length}</span><span className="mp-kpi__hint">{d.kpiActiveHint}</span></li>
            <li className="mp-kpi">
              <span className="mp-kpi__label">{d.kpiPayouts}<StatusPill tone={pendingPayouts.length > 0 ? 'warn' : 'ok'}>{pendingPayouts.length > 0 ? `${d.kpiPayoutsPending} (${pendingPayouts.length.toString()})` : d.kpiPayoutsPaid}</StatusPill></span>
              <span className="mp-kpi__val"><AmountXaf amount={netPayoutXaf} /></span><span className="mp-kpi__hint">{dict.payouts.commissionNotice}</span>
            </li>
            <li className="mp-kpi">
              <span className="mp-kpi__label">{d.kpiLowStock}{lowStockOffers.length > 0 ? <StatusPill tone="bad">{lowStockOffers.length}</StatusPill> : null}</span>
              <span className="mp-kpi__val">{lowStockOffers.length}</span><span className="mp-kpi__hint">{d.kpiLowStockHint}</span>
            </li>
          </ul>
          <div className="mp-cols mp-cols--dash">
            <section className="mp-panel" aria-label={d.progressTitle}>
              <div className="mp-ph"><h2>{d.progressTitle}</h2></div>
              {BANDS.map(([label, minBp, maxBp]) => {
                const count = activeOrders.filter((o) => o.progressBasisPoints >= minBp && o.progressBasisPoints <= maxBp).length;
                return <div key={label} className="mp-hbar"><span>{label}</span><progress className="mp-hbar__meter" max={totalTracked} value={count} aria-label={label} /><b>{count}</b></div>;
              })}
              <div className="mp-hbar"><span>100 %</span><progress className="mp-hbar__meter mp-hbar__meter--ess" max={totalTracked} value={readyOrders.length} aria-label="100 %" /><b>{readyOrders.length}</b></div>
              <p className="mp-banner">{d.anonymityNotice}</p>
            </section>
            <section className="mp-panel" aria-label={d.upcomingTitle}>
              <div className="mp-ph">
                <h2>{d.upcomingTitle}</h2>
                <div className="mp-tabs">
                  <button type="button" className={tab === 'ready' ? 'mp-chip mp-chip--on' : 'mp-chip'} onClick={() => { setTab('ready'); }}>{d.tabReady(readyOrders.length)}</button>
                  <button type="button" className={tab === 'done' ? 'mp-chip mp-chip--on' : 'mp-chip'} onClick={() => { setTab('done'); }}>{d.tabDone(doneOrders.length)}</button>
                </div>
              </div>
              {shownOrders.length === 0 ? <EmptyState title={dict.orders.emptyTitle} description={dict.orders.emptyDescription} headingLevel={3} /> : (
                <div className="mp-table-wrap">
                  <table className="mp-table" aria-label={d.upcomingTitle}>
                    <thead><tr><th scope="col">{dict.orders.columns.offer}</th><th scope="col" className="mp-num">{dict.orders.columns.amount}</th><th scope="col">{dict.orders.columns.status}</th><th scope="col">{dict.orders.columns.handover}</th></tr></thead>
                    <tbody>
                      {shownOrders.map((order) => (
                        <tr key={order.orderId}>
                          <td><strong>{order.offerTitle ?? order.offerId ?? dict.common.none}</strong></td>
                          <td className="mp-num"><AmountXaf amount={order.targetXaf} /></td>
                          <td><StatusPill tone={order.status === 'FUNDED' ? 'ok' : 'plain'}>{dict.orders.status[order.status]}</StatusPill></td>
                          <td>{order.handedOverAt === null ? dict.common.none : <time dateTime={order.handedOverAt}>{dateFmt.format(new Date(order.handedOverAt))}</time>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
