'use client';

import { Button } from '@achat/ui';
import { useState, type ReactElement } from 'react';
import { getDictionary, type Locale } from '../i18n';

/**
 * D63 : navigation selon le rôle relu en base (`/v1/partner/sessions/current`).
 * Simple aide d'affichage : chaque route revérifie le rôle côté serveur.
 */
export function PortalNav({
  role,
  signOut,
  onSignedOut,
  locale = 'fr',
}: {
  readonly role: 'MANAGER' | 'SELLER';
  readonly locale?: Locale;
  readonly signOut: () => Promise<unknown>;
  readonly onSignedOut: () => void;
}): ReactElement {
  const t = getDictionary(locale).nav;
  const [pending, setPending] = useState(false);
  const links: readonly (readonly [string, string])[] = [
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
    <nav aria-label={t.label}>
      <ul>
        {links.map(([href, label]) => (
          <li key={href}><a href={href}>{label}</a></li>
        ))}
        <li><a href={`/langue/${locale === 'en' ? 'fr' : 'en'}`} lang={locale === 'en' ? 'fr' : 'en'}>{t.language}</a></li>
      </ul>
      <Button type="button" disabled={pending} onClick={() => void leave()}>{t.signOut}</Button>
    </nav>
  );
}
