'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, EmptyState, ErrorState } from '@achat/ui';
import { useEffect, useState, type ReactElement } from 'react';
import { getDictionary, type Dictionary, type Locale } from '../i18n';

export type PartnerOfferRow = components['schemas']['PartnerOffer'];

/** Lecture injectée (`browserOffersPorts`) ; le serveur ne renvoie que les offres du partenaire de la session. */
export type OffersPorts = {
  readonly load: () => Promise<{ readonly ok: true; readonly rows: readonly PartnerOfferRow[] } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

function stock(offer: PartnerOfferRow, t: Dictionary['offers']): string {
  if (offer.availabilityKind === 'PREORDER') return t.preorder;
  return `${(offer.availableUnits ?? 0).toString()} / ${(offer.stockUnits ?? 0).toString()}`;
}

/** F-PRT-002 / D63 : offres en lecture ; la publication reste au personnel en maker-checker. */
export function OffersBoard({ ports, locale = 'fr' }: { readonly ports: OffersPorts; readonly locale?: Locale }): ReactElement {
  const dictionary = getDictionary(locale);
  const t = dictionary.offers;
  const [rows, setRows] = useState<readonly PartnerOfferRow[] | null>(null);
  const [problem, setProblem] = useState<ProblemSummary | null>(null);
  useEffect(() => {
    let live = true;
    ports.load()
      .then((result) => {
        if (!live) return;
        if (result.ok) setRows(result.rows);
        else setProblem(result.problem);
      })
      .catch(() => { if (live) setProblem({ title: dictionary.common.loadFailed, detail: dictionary.common.serviceDown }); });
    return () => { live = false; };
  }, [ports, dictionary]);
  return (
    <section>
      <h1>{t.title}</h1>
      <p>{t.notice}</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <table aria-label={t.table}>
          <thead>
            <tr><th scope="col">{t.columns.offer}</th><th scope="col">{t.columns.price}</th><th scope="col">{t.columns.stock}</th><th scope="col">{t.columns.catalog}</th></tr>
          </thead>
          <tbody>
            {rows.map((offer) => (
              <tr key={offer.offerId}>
                <td>{offer.title ?? (offer.state === 'DRAFT' ? t.untitledDraft : t.untitled)}</td>
                <td><AmountXaf amount={offer.priceXaf} /></td>
                <td>{stock(offer, t)}</td>
                <td>{offer.publiclyVisible ? t.visible : t.hidden}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
