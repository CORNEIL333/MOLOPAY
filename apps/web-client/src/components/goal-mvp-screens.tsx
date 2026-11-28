'use client';

import type { components } from '@achat/contracts/api';
import { AmountXaf, Badge, CotisationRing } from '@achat/ui';
import type { ReactElement } from 'react';
import type { Locale } from '../i18n';
import { formatDateTime } from '../lib/date';

type Goal = components['schemas']['Goal'];
type HandoverCode = components['schemas']['HandoverCode'];

/** D92 : écran « Verser » en état honnêtement bloqué (aucun bouton de paiement ni simulation). */
export function PayComingSoonPanel({
  goal,
  locale,
}: {
  readonly goal: Goal;
  readonly locale: Locale;
}): ReactElement {
  const isEn = locale === 'en';
  const item = goal.offerTitle ?? (isEn ? 'Planned expense' : 'Dépense planifiée');
  const filled = Math.max(0, Math.min(8, Math.round((goal.progressBasisPoints / 10000) * 8)));

  return (
    <section aria-labelledby="pay-soon-title" className="mp-panel">
      <div className="mp-ph">
        <div>
          <Badge tone="info">{isEn ? 'Payments closed in 0.0.1' : 'Versements bientôt disponibles'}</Badge>
          <h1 id="pay-soon-title" className="page-title">{item}</h1>
        </div>
        <CotisationRing filled={filled} size={52} locale={locale} />
      </div>
      <dl className="mp-kv">
        <dt>{isEn ? 'Locked price' : 'Prix figé'}</dt>
        <dd><AmountXaf amount={goal.targetXaf} /></dd>
      </dl>
      <p role="status" className="mp-banner">
        {isEn
          ? 'Payments will open soon. Your project is reserved and your price is locked; we will text you as soon as you can pay.'
          : 'Les versements ouvriront bientôt. Votre projet est réservé et votre prix est figé ; nous vous préviendrons par SMS dès que vous pourrez verser.'}
      </p>
      <a href={`/objectifs/${encodeURIComponent(goal.goalId)}`}>
        {isEn ? 'Back to my project' : 'Retour à mon projet'}
      </a>
    </section>
  );
}

/** D69 : écran du code de remise à usage unique (jamais sur du verre). */
export function HandoverCodePanel({
  goal,
  handover,
  locale,
}: {
  readonly goal: Goal;
  readonly handover: HandoverCode | null;
  readonly locale: Locale;
}): ReactElement {
  const isEn = locale === 'en';
  const item = goal.offerTitle ?? (isEn ? 'item' : 'article');

  return (
    <section aria-labelledby="handover-title" className="mp-panel">
      {handover === null ? (
        <>
          <h1 id="handover-title" className="page-title">
            {isEn ? 'Handover code' : 'Code de remise'}
          </h1>
          <p role="status" className="mp-banner">
            {isEn
              ? 'Collection is not available yet: payment must be 100% complete.'
              : 'Le retrait n’est pas encore disponible : le paiement doit être complet.'}
          </p>
        </>
      ) : (
        <>
          <Badge tone="success">{isEn ? 'Valid code · single use' : 'Code valide · usage unique'}</Badge>
          <h1 id="handover-title" className="page-title">
            {isEn ? `Done. Your ${item} is waiting for you.` : `C’est fait. Votre ${item} vous attend.`}
          </h1>
          <p className="mp-code-display" data-mp-financial="true">{handover.code}</p>
          <p className="mp-sub">
            {isEn
              ? `Valid until ${formatDateTime(handover.expiresAt, 'en')} · single use`
              : `Valable jusqu’au ${formatDateTime(handover.expiresAt, 'fr')} · usage unique`}
          </p>
          <p className="mp-banner">
            {isEn ? 'Show it with your ID' : 'À présenter avec votre pièce d’identité'}
          </p>
        </>
      )}
      <a href={`/objectifs/${encodeURIComponent(goal.goalId)}`}>
        {isEn ? 'Back to my project' : 'Retour à mon projet'}
      </a>
    </section>
  );
}
