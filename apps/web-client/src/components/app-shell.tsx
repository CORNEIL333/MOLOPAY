import type { ReactElement, ReactNode } from 'react';
import type { Dictionary, Locale } from '../i18n';

export function AppShell({ children, dictionary, locale }: {
  readonly children: ReactNode;
  readonly dictionary: Dictionary;
  readonly locale: Locale;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main">{dictionary.nav.skipToContent}</a>
      <header className="app-header">
        <div className="app-header__inner">
          <a href="/" className="wordmark">{dictionary.appName}</a>
          <nav aria-label={dictionary.appName}>
            <a href="/">{dictionary.nav.catalog}</a>
            <a href="/objectifs">{dictionary.nav.goals}</a>
            <a href="/connexion">{dictionary.nav.account}</a>
          </nav>
          <a className="locale-switch" href={locale === 'fr' ? '/langue/en' : '/langue/fr'} hrefLang={locale === 'fr' ? 'en' : 'fr'} lang={locale === 'fr' ? 'en' : 'fr'}>
            {locale === 'fr' ? 'English' : 'Français'}
          </a>
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>{children}</main>
    </>
  );
}
