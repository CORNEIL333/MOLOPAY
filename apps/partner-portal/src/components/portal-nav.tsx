'use client';

import { Button } from '@achat/ui';
import { useState, type ReactElement } from 'react';

/**
 * D63 : navigation selon le rôle relu en base (`/v1/partner/sessions/current`).
 * Simple aide d'affichage : chaque route revérifie le rôle côté serveur.
 */
export function PortalNav({
  role,
  signOut,
  onSignedOut,
}: {
  readonly role: 'MANAGER' | 'SELLER';
  readonly signOut: () => Promise<unknown>;
  readonly onSignedOut: () => void;
}): ReactElement {
  const [pending, setPending] = useState(false);
  const links: readonly (readonly [string, string])[] = [
    ['/comptoir', 'Comptoir'],
    ['/commandes', 'Commandes'],
    ['/offres', 'Offres'],
    ...(role === 'MANAGER' ? ([['/reglements', 'Règlements'], ['/vendeurs', 'Vendeurs']] as const) : []),
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
    <nav aria-label="Portail partenaire">
      <ul>
        {links.map(([href, label]) => (
          <li key={href}><a href={href}>{label}</a></li>
        ))}
      </ul>
      <Button type="button" disabled={pending} onClick={() => void leave()}>Se déconnecter</Button>
    </nav>
  );
}
