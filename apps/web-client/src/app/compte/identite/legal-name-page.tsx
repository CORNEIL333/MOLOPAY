'use client';
import type { ReactElement } from 'react';
import { LegalNameForm, type LegalNamePort } from '../../../components/legal-name-form';
import type { Locale } from '../../../i18n';
import { browserApi } from '../../../lib/browser-api';
import { problemFrom } from '../../../lib/problem';

/** Route réelle `POST /v1/me/legal-name` (D68) ; une clé d'idempotence par envoi. */
const browserLegalNamePort: LegalNamePort = async (legalName) => {
  const result = await browserApi().POST('/v1/me/legal-name', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: { legalName }, cache: 'no-store' });
  return result.data === undefined
    ? { ok: false, problem: problemFrom(result.error, result.response, 'Enregistrement non confirmé') }
    : { ok: true, verification: result.data.verification };
};

export function LegalNamePage({ locale }: { readonly locale: Locale }): ReactElement {
  return <LegalNameForm locale={locale} submit={browserLegalNamePort} />;
}
