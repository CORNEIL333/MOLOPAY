import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import '@achat/ui/styles.css';

export const metadata: Metadata = {
  title: { default: 'Back-office MoloPay', template: '%s · Back-office MoloPay' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="fr">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
