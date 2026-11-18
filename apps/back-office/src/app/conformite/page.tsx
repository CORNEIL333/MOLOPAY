import type { ReactElement } from 'react';
import { CompliancePage } from './compliance-page';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default async function Conformite({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const value = (await searchParams)['filtrage'];
  return <CompliancePage initialScreeningId={typeof value === 'string' && UUID.test(value) ? value : ''} />;
}
