'use client';

import { BrandRing, Button } from '@achat/ui';
import { useState, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';

/**
 * D63 : navigation selon le rôle relu en base (`/v1/partner/sessions/current`).
 * Simple aide d'affichage : chaque route revérifie le rôle côté serveur.
 */
export function PortalNav({
  role,
  pathname,
  signOut,
  onSignedOut,
  locale = 'fr',
}: {
  readonly role: 'MANAGER' | 'SELLER';
  readonly pathname?: string;
  readonly locale?: Locale;
  readonly signOut: () => Promise<unknown>;
  readonly onSignedOut: () => void;
}): ReactElement {
  const t = getDictionary(locale).nav;
  const [pending, setPending] = useState(false);
  const links: readonly (readonly [string, string])[] = [
    ...(role === 'MANAGER' ? ([['/tableau-de-bord', t.dashboard]] as const) : []),
    ['/comptoir', t.counter],
    ['/commandes', t.orders],
    ['/offres', t.offers],
    ...(role === 'MANAGER' ? ([['/reglements', t.payouts], ['/vendeurs', t.sellers]] as const) : []),
  ];

  async function leave(): Promise<void> {
    setPending(true);
    try {
      await signOut();
    } catch {
      // La session expire de toute façon en 15 minutes ; le cookie reste httpOnly.
    } finally {
      setPending(false);
      onSignedOut();
    }
  }

  return (
    <nav className="mp-side" aria-label={t.label}>
      <div className="mp-brand">
        <BrandRing tone="light" />
        <span>molopay</span>
        <small>{t.brandBadge}</small>
      </div>
      <ul className="mp-navlist">
        {links.map(([href, label]) => (
          <li key={href}>
            <a className="mp-navlink" href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a>
          </li>
        ))}
        <li>
          <a className="mp-navlink" href={`/langue/${locale === 'en' ? 'fr' : 'en'}`} lang={locale === 'en' ? 'fr' : 'en'}>{t.language}</a>
        </li>
      </ul>
      {role === 'SELLER' ? <p className="mp-banner">{t.sellerNotice}</p> : null}
      <div className="mp-side__footer">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void leave()}>{t.signOut}</Button>
      </div>
    </nav>
  );
}
