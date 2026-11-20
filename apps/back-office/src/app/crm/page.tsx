import type { ReactElement } from 'react';
import { CrmPage } from './crm-page';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Q5 / F-SUP-001 : fiche client 360° du support. */
export default async function Crm({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactElement> {
  const value = (await searchParams)['client'];
  return <CrmPage initialAccountId={typeof value === 'string' && UUID.test(value) ? value : ''} />;
}
