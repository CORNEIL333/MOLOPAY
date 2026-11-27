'use client';

import { Button } from '@achat/ui';
import { useState, type ReactElement } from 'react';

const LINKS: readonly (readonly [string, string])[] = [
  ['/file', 'File de travail'],
  ['/tableau-de-bord', 'Tableau de bord'],
  ['/indicateurs', 'Indicateurs'],
  ['/conformite', 'Conformité'],
  ['/reclamations', 'Réclamations'],
  ['/objectifs', 'Historique d’un objectif'],
  ['/clients/inscription-agence', 'Inscription en agence'],
  ['/clients/blocage', 'Bloquer un compte client'],
  ['/incidents/gel', 'Gel des flux sortants'],
  ['/administration', 'Administration'],
];

/** Pages sans session : aucun menu (connexion, enrôlement d'une clé). */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/', '/enrolement']);

/**
 * C6 : navigation du back-office. Simple aide d'affichage : chaque route
 * revérifie la session et les droits côté serveur (une page sans droit
 * affiche le refus du serveur).
 */
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
    <nav aria-label="Back-office">
      <ul>
        {LINKS.map(([href, label]) => (
          <li key={href}>
            <a href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a>
          </li>
        ))}
      </ul>
      <Button variant="secondary" disabled={pending} onClick={() => void leave()}>Se déconnecter</Button>
    </nav>
  );
}
