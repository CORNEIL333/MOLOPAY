'use client';

import type { components } from '@achat/contracts/api';
import type { ProblemSummary } from '@achat/contracts/client';
import { AmountXaf, EmptyState, ErrorState } from '@achat/ui';
import { useEffect, useState, type ReactElement } from 'react';

export type PartnerOfferRow = components['schemas']['PartnerOffer'];

/** Lecture injectée (`browserOffersPorts`) ; le serveur ne renvoie que les offres du partenaire de la session. */
export type OffersPorts = {
  readonly load: () => Promise<{ readonly ok: true; readonly rows: readonly PartnerOfferRow[] } | { readonly ok: false; readonly problem: ProblemSummary }>;
};

function stock(offer: PartnerOfferRow): string {
  if (offer.availabilityKind === 'PREORDER') return 'Précommande';
  return `${(offer.availableUnits ?? 0).toString()} / ${(offer.stockUnits ?? 0).toString()}`;
}

/** F-PRT-002 / D63 : offres en lecture ; la publication reste au personnel en maker-checker. */
export function OffersBoard({ ports }: { readonly ports: OffersPorts }): ReactElement {
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
      .catch(() => { if (live) setProblem({ title: 'Chargement impossible', detail: 'Le service ne répond pas. Réessayez.' }); });
    return () => { live = false; };
  }, [ports]);
  return (
    <section>
      <h1>Offres</h1>
      <p>Les modifications d’offres passent par l’équipe MoloPay.</p>
      {problem === null ? null : <ErrorState problem={problem} />}
      {rows === null || problem !== null ? null : rows.length === 0 ? (
        <EmptyState title="Aucune offre." description="Vos offres apparaîtront ici après leur création par l’équipe MoloPay." />
      ) : (
        <table aria-label="Offres">
          <thead>
            <tr><th scope="col">Offre</th><th scope="col">Prix</th><th scope="col">Stock disponible</th><th scope="col">Catalogue</th></tr>
          </thead>
          <tbody>
            {rows.map((offer) => (
              <tr key={offer.offerId}>
                <td>{offer.title ?? (offer.state === 'DRAFT' ? 'Sans titre (brouillon)' : 'Sans titre')}</td>
                <td><AmountXaf amount={offer.priceXaf} /></td>
                <td>{stock(offer)}</td>
                <td>{offer.publiclyVisible ? 'Visible au catalogue' : 'Non visible'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
