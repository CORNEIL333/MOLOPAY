'use client';

import { BrandRing, Button } from '@achat/ui';
import { useState, type ReactElement } from 'react';

const GROUPS: readonly { readonly heading?: string; readonly links: readonly (readonly [string, string])[] }[] = [
  {
    links: [
      ['/file', 'File de travail'],
      ['/tableau-de-bord', 'Tableau de bord'],
      ['/indicateurs', 'Indicateurs'],
    ],
  },
  {
    heading: 'Clients et support',
    links: [
      ['/clients', 'Clients et support'],
      ['/conformite', 'Conformité'],
      ['/reclamations', 'Réclamations'],
      ['/objectifs', 'Historique d’un objectif'],
      ['/clients/inscription-agence', 'Inscription en agence'],
      ['/clients/blocage', 'Bloquer un compte client'],
      ['/clients/deces', 'Déclaration de décès'],
    ],
  },
  {
    heading: 'Contrôle',
    links: [
      ['/incidents/gel', 'Gel des flux sortants'],
      ['/administration', 'Administration'],
    ],
  },
];

const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/', '/enrolement']);

/** C6 : barre latérale noire du back-office (outil interne à plat, aucun verre ni fond liquide). */
export function BackofficeNav({
  pathname,
  signOut,
  onSignedOut,
}: {
  readonly pathname: string;
  readonly signOut: () => Promise<unknown>;
  readonly onSignedOut: () => void;
}): ReactElement | null {
  const [pending, setPending] = useState(false);
  if (PUBLIC_PATHS.has(pathname)) return null;

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
    <nav className="mp-side mp-side--dark" aria-label="Back-office">
      <div className="mp-brand">
        <BrandRing tone="dark" />
        <span>molopay</span>
        <small>Interne</small>
      </div>
      {GROUPS.map((group, idx) => (
        <div key={group.heading ?? String(idx)}>
          {group.heading === undefined ? null : <div className="mp-sgroup">{group.heading}</div>}
          <ul className="mp-navlist">
            {group.links.map(([href, label]) => (
              <li key={href}>
                <a className="mp-navlink" href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mp-side__footer">
        <Button variant="secondary" disabled={pending} onClick={() => void leave()}>Se déconnecter</Button>
      </div>
    </nav>
  );
}
