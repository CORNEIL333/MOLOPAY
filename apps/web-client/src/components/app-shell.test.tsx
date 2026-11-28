import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { AppShell } from './app-shell';

for (const locale of ['fr', 'en'] as const) {
  describe(`AppShell ${locale}`, () => {
    it('relie les parcours et expose une navigation accessible', async () => {
      const dictionary = getDictionary(locale);
      const { container } = render(
        <AppShell dictionary={dictionary} locale={locale}>
          <h1>{dictionary.catalog.title}</h1>
        </AppShell>,
      );
      expect(screen.getByRole('link', { name: dictionary.nav.goals })).toHaveAttribute('href', '/objectifs');
      expect(screen.getByRole('link', { name: dictionary.nav.account })).toHaveAttribute('href', '/compte');
      expect(screen.getByRole('link', { name: dictionary.nav.skipToContent })).toHaveAttribute('href', '#main');
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
      expect(screen.getByRole('link', { name: locale === 'fr' ? 'English' : 'Français' })).toHaveAttribute('href', locale === 'fr' ? '/langue/en' : '/langue/fr');
      await expectNoA11yViolations(container);
    });
  });
}
