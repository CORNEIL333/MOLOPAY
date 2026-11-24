import type { ProblemSummary } from '@achat/contracts/client';
import { CURRENT_TERMS_VERSION } from '@achat/contracts/terms';
import { browserApi } from './browser-api';
import { problemFrom } from './problem';

/** F-ACC-004 : version en vigueur, source unique partagée avec le serveur (`@achat/contracts`). */
export const TERMS_VERSION = CURRENT_TERMS_VERSION;

export type TermsOutcome = { readonly ok: true } | { readonly ok: false; readonly problem: ProblemSummary };

/** Acceptation de la version en vigueur (route réelle, clé d'idempotence par intention). */
export async function acceptCurrentTerms(errorTitle: string): Promise<TermsOutcome> {
  const result = await browserApi().POST('/v1/me/terms-acceptances', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { version: TERMS_VERSION },
    cache: 'no-store',
  });
  return result.response.status === 201 ? { ok: true } : { ok: false, problem: problemFrom(result.error, result.response, errorTitle) };
}
