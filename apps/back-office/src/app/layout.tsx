import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactElement, ReactNode } from 'react';
import '@achat/ui/styles.css';
import { SessionNav } from './session-nav';

const outfit = localFont({
  src: '../../../../packages/ui/fonts/Outfit-Variable.ttf',
  variable: '--font-outfit',
  weight: '300 700',
  display: 'swap',
});

const inter = localFont({
  src: '../../../../packages/ui/fonts/Inter-Variable.ttf',
  variable: '--font-inter',
  weight: '400 700',
  display: 'swap',
});

/**
 * SEC-API-005 / IMP-3 : rendu à chaque requête. La CSP à nonce (middleware)
 * n'est appliquée qu'aux pages dynamiques ; une page statique servirait des
 * scripts sans nonce, bloqués par 'strict-dynamic' (aucune hydratation).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Back-office MoloPay', template: '%s · Back-office MoloPay' },
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  return (
    <html lang="fr" className={`${outfit.variable} ${inter.variable}`}>
      <body>
        <SessionNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
