import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import '@achat/ui/styles.css';
import './globals.css';
import { AppShell } from '../components/app-shell';
import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import { getDictionary } from '../i18n';
import { currentLocale } from '../lib/locale';

export const metadata: Metadata = {
  title: { default: 'MoloPay', template: '%s · MoloPay' },
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export default async function RootLayout({ children }: { readonly children: ReactNode }): Promise<ReactElement> {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <AppShell dictionary={getDictionary(locale)} locale={locale}>{children}</AppShell>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
