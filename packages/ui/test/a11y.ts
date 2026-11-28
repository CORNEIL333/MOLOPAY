import axe from 'axe-core';

const COMPONENT_SCOPE_EXCLUSIONS = [
  // Ces règles visent une page entière, pas un composant isolé.
  'region',
  'landmark-one-main',
  'page-has-heading-one',
  'html-has-lang',
  'document-title',
  'bypass',
  // jsdom ne calcule pas les couleurs ; le contraste est vérifié sur les jetons.
  'color-contrast',
] as const;

export async function expectNoA11yViolations(
  container: HTMLElement,
): Promise<void> {
  const results = await axe.run(container, {
    rules: Object.fromEntries(
      COMPONENT_SCOPE_EXCLUSIONS.map((rule) => [rule, { enabled: false }]),
    ),
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes
            .map((node) => node.target.join(' '))
            .join(', ')})`,
      )
      .join('\n');
    throw new Error(`Accessibilité non conforme:\n${summary}`);
  }
}
