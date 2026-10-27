import type { ReactElement, ReactNode } from 'react';

export type EmptyStateProps = {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly headingLevel?: 2 | 3;
};

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: EmptyStateProps): ReactElement {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className="achat-state">
      <Heading className="achat-state__title">{title}</Heading>
      <p className="achat-state__detail">{description}</p>
      {action}
    </section>
  );
}
