'use client';

import { BrandRing, FloatingNavBar } from '@achat/ui';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { Dictionary, Locale } from '../i18n';

export function AppShell({ children, dictionary, locale }: {
  readonly children: ReactNode;
  readonly dictionary: Dictionary;
  readonly locale: Locale;
}): ReactElement {
  const [activeHref, setActiveHref] = useState('/');
  useEffect(() => {
    setActiveHref(window.location.pathname);
  }, []);

  return (
    <div className="pwa-stage">
      <a className="skip-link" href="#main">{dictionary.nav.skipToContent}</a>
      <header className="app-header">
        <div className="app-header__inner">
          <a href="/" className="wordmark">
            <BrandRing filled={8} size={24} />
            <span>{dictionary.appName}</span>
          </a>
          <a className="locale-switch" href={locale === 'fr' ? '/langue/en' : '/langue/fr'} hrefLang={locale === 'fr' ? 'en' : 'fr'} lang={locale === 'fr' ? 'en' : 'fr'}>
            {locale === 'fr' ? 'English' : 'Français'}
          </a>
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>{children}</main>
      <div className="pwa-float-dock">
        <FloatingNavBar
          ariaLabel={dictionary.appName}
          activeHref={activeHref}
          items={[
            { href: '/', label: dictionary.nav.catalog, icon: 'search' },
            { href: '/favoris', label: locale === 'en' ? 'My wishlist' : 'Mes envies', icon: 'heart' },
            { href: '/objectifs', label: dictionary.nav.goals, icon: 'home' },
            { href: '/compte', label: dictionary.nav.account, icon: 'user' },
          ]}
        />
      </div>
    </div>
  );
}
