import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import '@achat/ui/styles.css';
import { currentLocale } from '../lib/locale';
import { SessionNav } from './session-nav';

export const metadata: Metadata = {
  title: { default: 'Portail partenaire MoloPay', template: '%s · Portail partenaire MoloPay' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { readonly children: ReactNode }): Promise<ReactElement> {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <SessionNav locale={locale} />
        <main>{children}</main>
      </body>
    </html>
  );
}
