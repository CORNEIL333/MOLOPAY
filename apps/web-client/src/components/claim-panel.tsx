'use client';
import type { ReactElement } from 'react';
import type { Locale } from '../i18n';
import { browserApi } from '../lib/browser-api';
import { problemFrom } from '../lib/problem';
import { ClaimForm, type ClaimPort } from './claim-form';

/** Port navigateur : route réelle, une clé d'idempotence par envoi. */
export function ClaimPanel({ goalId, locale }: { readonly goalId: string; readonly locale: Locale }): ReactElement {
  const submit: ClaimPort = async (claim) => {
    const result = await browserApi().POST('/v1/goals/{goalId}/claims', {
      params: { path: { goalId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: claim,
      cache: 'no-store',
    });
    return result.data === undefined ? { ok: false, problem: problemFrom(result.error, result.response, 'Réclamation non confirmée') } : { ok: true, receipt: result.data };
  };
  return <ClaimForm locale={locale} submit={submit} />;
}
