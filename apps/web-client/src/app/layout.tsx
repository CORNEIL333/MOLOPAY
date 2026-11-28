import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactElement, ReactNode } from 'react';
import { VisualEffectsProvider } from '@achat/ui';
import '@achat/ui/styles.css';
import './globals.css';
import { AppShell } from '../components/app-shell';
import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import { getDictionary } from '../i18n';
import { currentLocale } from '../lib/locale';

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
  title: { default: 'MoloPay', template: '%s · MoloPay' },
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
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
        <VisualEffectsProvider>
          <AppShell dictionary={getDictionary(locale)} locale={locale}>
            {children}
          </AppShell>
        </VisualEffectsProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
