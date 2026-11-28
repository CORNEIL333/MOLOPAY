import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactElement, ReactNode } from 'react';
import '@achat/ui/styles.css';
import { currentLocale } from '../lib/locale';
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

export const metadata: Metadata = {
  title: { default: 'Portail partenaire MoloPay', template: '%s · Portail partenaire MoloPay' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<ReactElement> {
  const locale = await currentLocale();
  return (
    <html lang={locale} className={`${outfit.variable} ${inter.variable}`}>
      <body>
        <div className="mp-shell">
          <SessionNav locale={locale} />
          <main className="mp-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
